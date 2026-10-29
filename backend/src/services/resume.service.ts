import { v4 as uuidv4 } from 'uuid';
import type { PoolConnection } from 'mysql2/promise';
import pool from '../config/database';
import type { SkillsByCategory } from './ai.service';

type Queryable = Pick<PoolConnection, 'execute'>;

// Every change to a group's versions first locks the group row, always this
// way, so concurrent uploads, extractions and deletions are serialised without
// lock-order deadlocks. Returns the group id, or null if the resume does not
// exist (or, when userId is given, is not that user's).
export const lockGroupOf = async (connection: Queryable, resumeId: string, userId?: string): Promise<string | null> => {
  const [rows]: any = await connection.execute(
    `SELECT g.id FROM resume_groups g
      WHERE g.id = (SELECT r.resume_group_id FROM resumes r WHERE r.id = ?${userId ? ' AND r.user_id = ?' : ''})
      FOR UPDATE`,
    userId ? [resumeId, userId] : [resumeId]
  );
  return rows[0]?.id ?? null;
};

// Version changes run at READ COMMITTED: once the group lock is held, every read
// sees the latest committed rows. (Under the default REPEATABLE READ, a read
// after waiting for the lock could still see an older snapshot.)
export const beginVersionTransaction = async (connection: PoolConnection) => {
  await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
  await connection.beginTransaction();
};

// Reserves the next version number in the group of `resumeId` (one of the
// user's resumes). Must run inside a version transaction; the group lock it
// takes serialises concurrent uploads, so each gets its own number.
export const reserveNextVersion = async (connection: PoolConnection, resumeId: string, userId: string) => {
  const groupId = await lockGroupOf(connection, resumeId, userId);
  if (!groupId) return null;
  const [groups]: any = await connection.execute(
    'SELECT latest_version_number as latestVersionNumber FROM resume_groups WHERE id = ? AND user_id = ?',
    [groupId, userId]
  );
  const versionNumber = Number(groups[0].latestVersionNumber) + 1;
  await connection.execute('UPDATE resume_groups SET latest_version_number = ? WHERE id = ?', [versionNumber, groupId]);
  return { groupId, versionNumber };
};

export interface CreatedResume {
  id: string;
  resumeGroupId: string;
  versionNumber: number;
}

// Saves an uploaded file as a resume. Without `versionOf` it starts a new group
// as version 1; with it, the upload becomes the next version of that resume's
// group. Returns null if `versionOf` is not one of the user's resumes.
// A new version is not current yet: it becomes current once its text has been
// extracted (see reconcileCurrentVersion).
export const createResume = async (
  userId: string,
  originalFilename: string,
  storedFilename: string,
  filePath: string,
  fileSize: number,
  mimeType: string,
  options: { versionOf?: string; versionLabel?: string | null } = {}
): Promise<CreatedResume | null> => {
  const id = uuidv4();
  const connection = await pool.getConnection();
  try {
    await beginVersionTransaction(connection);

    let groupId: string;
    let versionNumber: number;
    if (options.versionOf) {
      const next = await reserveNextVersion(connection, options.versionOf, userId);
      if (!next) {
        await connection.rollback();
        return null;
      }
      ({ groupId, versionNumber } = next);
    } else {
      groupId = uuidv4();
      versionNumber = 1;
      await connection.execute('INSERT INTO resume_groups (id, user_id, latest_version_number) VALUES (?, ?, 1)', [groupId, userId]);
    }

    await connection.execute(
      `INSERT INTO resumes (id, user_id, resume_group_id, version_number, version_label, original_filename, stored_filename,
         file_path, file_size, mime_type, extraction_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, groupId, versionNumber, options.versionLabel ?? null, originalFilename, storedFilename, filePath, fileSize, mimeType, 'pending']
    );
    await connection.commit();
    return { id, resumeGroupId: groupId, versionNumber };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// Makes `resumeId` the only current version of its group (null: none is current).
const setCurrent = async (connection: Queryable, groupId: string, resumeId: string | null) => {
  // Cleared first: the unique index allows one current row per group at any time.
  await connection.execute('UPDATE resumes SET is_current = 0 WHERE resume_group_id = ? AND is_current = 1', [groupId]);
  if (resumeId) await connection.execute('UPDATE resumes SET is_current = 1 WHERE id = ? AND resume_group_id = ?', [resumeId, groupId]);
};

const newestCompletedVersion = async (connection: Queryable, groupId: string): Promise<string | null> => {
  const [rows]: any = await connection.execute(
    `SELECT id FROM resumes WHERE resume_group_id = ? AND extraction_status = 'completed' AND source_type = 'upload'
      ORDER BY version_number DESC LIMIT 1`,
    [groupId]
  );
  return rows[0]?.id ?? null;
};

// Applies the current-version policy after a version's extraction finished:
//   * a version whose text was extracted becomes current if it is newer than the
//     current one (an older version re-extracted later does not take over);
//   * if there is no usable current version (none yet, or its re-extraction
//     failed), the newest version with extracted text becomes current.
// A version that failed processing never becomes current.
export const reconcileCurrentVersion = async (resumeId: string) => {
  const connection = await pool.getConnection();
  try {
    await beginVersionTransaction(connection);
    const groupId = await lockGroupOf(connection, resumeId);
    if (!groupId) {
      await connection.rollback();
      return;
    }
    const [rows]: any = await connection.execute(
      'SELECT version_number as versionNumber, extraction_status as status, source_type as sourceType FROM resumes WHERE id = ?',
      [resumeId]
    );
    const { versionNumber, status, sourceType } = rows[0];
    const [currentRows]: any = await connection.execute(
      'SELECT id, version_number as versionNumber, extraction_status as status FROM resumes WHERE resume_group_id = ? AND is_current = 1',
      [groupId]
    );
    const current = currentRows[0];
    // Tailored copies become current only when the user chooses them.
    if (status === 'completed' && sourceType === 'upload' && (!current || versionNumber > current.versionNumber)) {
      await setCurrent(connection, groupId, resumeId);
    } else if (!current || current.status !== 'completed') {
      await setCurrent(connection, groupId, await newestCompletedVersion(connection, groupId));
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export type SetCurrentResult = 'updated' | 'not_found' | 'not_ready';

// Explicitly makes one of the user's versions current. Only a version whose
// text has been extracted can be current; this is also the only way a
// tailored copy becomes current.
export const setCurrentVersion = async (resumeId: string, userId: string): Promise<SetCurrentResult> => {
  const connection = await pool.getConnection();
  try {
    await beginVersionTransaction(connection);
    const groupId = await lockGroupOf(connection, resumeId, userId);
    if (!groupId) {
      await connection.rollback();
      return 'not_found';
    }
    const [rows]: any = await connection.execute('SELECT extraction_status as status FROM resumes WHERE id = ? AND user_id = ?', [
      resumeId,
      userId,
    ]);
    if (rows[0].status !== 'completed') {
      await connection.rollback();
      return 'not_ready';
    }
    await setCurrent(connection, groupId, resumeId);
    await connection.commit();
    return 'updated';
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const updateExtractionStatus = async (
  id: string,
  status: string,
  textContent: string | null = null,
  errorMsg: string | null = null
) => {
  if (textContent !== null) {
    await pool.execute(
      'UPDATE resumes SET extraction_status = ?, text_content = ?, extraction_error = NULL WHERE id = ?',
      [status, textContent, id]
    );
  } else if (errorMsg !== null) {
    await pool.execute(
      'UPDATE resumes SET extraction_status = ?, extraction_error = ?, text_content = NULL WHERE id = ?',
      [status, errorMsg, id]
    );
  } else {
    await pool.execute(
      'UPDATE resumes SET extraction_status = ? WHERE id = ?',
      [status, id]
    );
  }
};

// Version fields shared by the resume queries; `r` is the resumes table.
const VERSION_COLUMNS = `r.resume_group_id as resumeGroupId, r.version_number as versionNumber,
  r.version_label as versionLabel, r.is_current as isCurrent, r.source_type as sourceType, r.export_template as exportTemplate,
  (SELECT COUNT(*) FROM resumes v WHERE v.resume_group_id = r.resume_group_id) as versionCount`;

const SUMMARY_COLUMNS = `r.id, r.original_filename as originalFilename, r.stored_filename as storedFilename,
  r.file_size as fileSize, r.mime_type as mimeType, r.extraction_status as extractionStatus,
  r.skills_extracted_at as skillsExtractedAt, r.created_at as createdAt, ${VERSION_COLUMNS}`;

export const getUserResumes = async (userId: string) => {
  const [rows]: any = await pool.execute(
    `SELECT ${SUMMARY_COLUMNS} FROM resumes r WHERE r.user_id = ? ORDER BY r.created_at DESC, r.version_number DESC`,
    [userId]
  );
  return rows;
};

export const getResumeById = async (id: string, userId: string) => {
  const [rows]: any = await pool.execute(
    `SELECT ${SUMMARY_COLUMNS}, r.file_path as filePath FROM resumes r WHERE r.id = ? AND r.user_id = ?`,
    [id, userId]
  );
  return rows[0] || null;
};

// All versions in the group of one of the user's resumes, newest first; null if
// the resume is not the user's.
export const getResumeVersions = async (resumeId: string, userId: string) => {
  const [rows]: any = await pool.execute(
    `SELECT ${SUMMARY_COLUMNS}
       FROM resumes r
       JOIN resumes owned ON owned.resume_group_id = r.resume_group_id AND owned.user_id = r.user_id
      WHERE owned.id = ? AND owned.user_id = ?
      ORDER BY r.version_number DESC`,
    [resumeId, userId]
  );
  return rows.length > 0 ? rows : null;
};

export const getResumeTextById = async (id: string, userId: string) => {
  const [rows]: any = await pool.execute(
    'SELECT id, extraction_status as extractionStatus, text_content as textContent FROM resumes WHERE id = ? AND user_id = ?',
    [id, userId]
  );
  return rows[0] || null;
};

// Replaces all stored skills for a resume in one transaction, so re-running
// extraction never leaves duplicates or a mix of old and new skills.
// Returns false if the resume does not exist or belongs to another user.
export const replaceResumeSkills = async (id: string, userId: string, skills: SkillsByCategory) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Locking the resume row serialises concurrent extractions of the same resume.
    const [owned]: any = await connection.execute(
      'SELECT id FROM resumes WHERE id = ? AND user_id = ? FOR UPDATE',
      [id, userId]
    );
    if (owned.length === 0) {
      await connection.rollback();
      return false;
    }

    await connection.execute('DELETE FROM resume_skills WHERE resume_id = ?', [id]);

    const seen = new Set<string>();
    const rows: [string, string, string][] = [];
    for (const [category, names] of Object.entries(skills)) {
      for (const name of names) {
        if (seen.has(name)) continue;
        seen.add(name);
        rows.push([id, name, category]);
      }
    }
    if (rows.length > 0) {
      await connection.query(
        'INSERT INTO resume_skills (resume_id, skill_name, skill_category) VALUES ?',
        [rows]
      );
    }

    await connection.execute('UPDATE resumes SET skills_extracted_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// Returns stored skills grouped by category, in the order they were extracted.
export const getResumeSkills = async (id: string, userId: string): Promise<SkillsByCategory> => {
  const [rows]: any = await pool.execute(
    'SELECT rs.skill_name as skillName, rs.skill_category as skillCategory FROM resume_skills rs JOIN resumes r ON r.id = rs.resume_id WHERE rs.resume_id = ? AND r.user_id = ? ORDER BY rs.id',
    [id, userId]
  );

  const skills: SkillsByCategory = {};
  for (const row of rows) {
    (skills[row.skillCategory] ??= []).push(row.skillName);
  }
  return skills;
};

// Deletes one version. Its skills and the saved matches that used it go with it
// (ON DELETE CASCADE); other versions are untouched. If it was current, the
// newest remaining version with extracted text becomes current; an emptied group
// is removed. Returns the deleted file's path (for the caller to remove once the
// database change is committed), or null if the resume is not the user's.
export const deleteResume = async (id: string, userId: string): Promise<{ filePath: string } | null> => {
  const connection = await pool.getConnection();
  try {
    await beginVersionTransaction(connection);
    const groupId = await lockGroupOf(connection, id, userId);
    if (!groupId) {
      await connection.rollback();
      return null;
    }
    const [rows]: any = await connection.execute(
      'SELECT is_current as isCurrent, file_path as filePath FROM resumes WHERE id = ? AND user_id = ?',
      [id, userId]
    );
    const { isCurrent, filePath } = rows[0];
    await connection.execute('DELETE FROM resumes WHERE id = ? AND user_id = ?', [id, userId]);

    const [remaining]: any = await connection.execute('SELECT COUNT(*) as total FROM resumes WHERE resume_group_id = ?', [groupId]);
    if (Number(remaining[0].total) === 0) {
      await connection.execute('DELETE FROM resume_groups WHERE id = ? AND user_id = ?', [groupId, userId]);
    } else if (Number(isCurrent) === 1) {
      await setCurrent(connection, groupId, await newestCompletedVersion(connection, groupId));
    }
    await connection.commit();
    return { filePath };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};
