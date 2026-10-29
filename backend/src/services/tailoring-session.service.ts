import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import { beginVersionTransaction, reserveNextVersion } from './resume.service';
import { UPLOAD_DIR } from '../middleware/upload.middleware';
import type { RequirementCoverage, ReviewStatus, SuggestionDraft, TailoringNote } from './resume-tailoring.service';

// Tailoring sessions (Step 9C). Every query is scoped to the signed-in user and
// to the resume in the URL, so another user's session behaves exactly like one
// that does not exist.

export const MAX_SUGGESTIONS = 100;

const parseJson = <T>(value: unknown): T => (typeof value === 'string' ? JSON.parse(value) : value) as T;

// Stores a session and its suggestions. The resume and the job description
// must both be the user's (checked in the same statement); returns the new id,
// or null when nothing was stored.
export const createSession = async (
  userId: string,
  resumeId: string,
  jobDescriptionId: string,
  result: { suggestions: SuggestionDraft[]; requirements: RequirementCoverage[]; notes: TailoringNote[] }
): Promise<string | null> => {
  const id = uuidv4();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [inserted]: any = await connection.execute(
      `INSERT INTO resume_tailoring_sessions (id, user_id, resume_id, job_description_id, requirements_json, notes_json)
       SELECT ?, r.user_id, r.id, jd.id, CAST(? AS JSON), CAST(? AS JSON)
         FROM resumes r JOIN job_descriptions jd ON jd.user_id = r.user_id
        WHERE r.id = ? AND jd.id = ? AND r.user_id = ?`,
      [id, JSON.stringify(result.requirements), JSON.stringify(result.notes), resumeId, jobDescriptionId, userId]
    );
    if (inserted.affectedRows !== 1) {
      await connection.rollback();
      return null;
    }
    const rows = result.suggestions.slice(0, MAX_SUGGESTIONS).map((s, position) => [
      uuidv4(),
      id,
      position,
      s.category,
      s.section,
      s.lineIndex,
      s.originalText,
      s.suggestedText,
      s.entryLabel?.slice(0, 300) ?? null,
      s.reason.slice(0, 600),
      JSON.stringify(s.relatedRequirements),
    ]);
    if (rows.length > 0) {
      await connection.query(
        `INSERT INTO resume_tailoring_suggestions
           (id, session_id, position, category, section, line_index, original_text, suggested_text, entry_label, reason, related_requirements)
         VALUES ?`,
        [rows]
      );
    }
    await connection.commit();
    return id;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const SESSION_COLUMNS = `s.id, s.resume_id as resumeId, s.job_description_id as jobDescriptionId, s.status,
  s.saved_resume_id as savedResumeId, s.created_at as createdAt, s.updated_at as updatedAt,
  jd.title as jobTitle, jd.company_name as companyName,
  r.original_filename as resumeFilename, r.version_number as versionNumber, r.version_label as versionLabel`;

const SESSION_FROM = `FROM resume_tailoring_sessions s
  JOIN resumes r ON r.id = s.resume_id
  JOIN job_descriptions jd ON jd.id = s.job_description_id`;

const toSuggestion = (row: any) => ({
  id: row.id,
  category: row.category,
  section: row.section,
  lineIndex: Number(row.lineIndex),
  entryLabel: row.entryLabel,
  originalText: row.originalText,
  suggestedText: row.suggestedText,
  editedText: row.editedText,
  reason: row.reason,
  relatedRequirements: parseJson<string[]>(row.relatedRequirements),
  status: row.status as ReviewStatus,
  updatedAt: row.updatedAt,
});

export type TailoringSuggestion = ReturnType<typeof toSuggestion>;

const SUGGESTION_COLUMNS = `id, category, section, line_index as lineIndex, entry_label as entryLabel,
  original_text as originalText, suggested_text as suggestedText, edited_text as editedText, reason,
  related_requirements as relatedRequirements, status, updated_at as updatedAt`;

export const listSessions = async (resumeId: string, userId: string) => {
  const [rows]: any = await pool.execute(
    `SELECT ${SESSION_COLUMNS},
            (SELECT COUNT(*) FROM resume_tailoring_suggestions t WHERE t.session_id = s.id) as suggestionCount,
            (SELECT COUNT(*) FROM resume_tailoring_suggestions t WHERE t.session_id = s.id AND t.status IN ('accepted', 'edited')) as acceptedCount
       ${SESSION_FROM}
      WHERE s.resume_id = ? AND s.user_id = ?
      ORDER BY s.created_at DESC, s.id DESC`,
    [resumeId, userId]
  );
  return rows.map((row: any) => ({
    ...toSessionSummary(row),
    suggestionCount: Number(row.suggestionCount),
    acceptedCount: Number(row.acceptedCount),
  }));
};

export interface TailoringSessionSummary {
  id: string;
  resumeId: string;
  jobDescriptionId: string;
  status: 'draft' | 'saved';
  savedResumeId: string | null;
  createdAt: Date;
  updatedAt: Date;
  jobTitle: string;
  companyName: string | null;
  resumeFilename: string;
  versionNumber: number;
  versionLabel: string | null;
}

export interface TailoringSessionDetail extends TailoringSessionSummary {
  method: 'rule_based';
  requirements: RequirementCoverage[];
  notes: TailoringNote[];
  suggestions: TailoringSuggestion[];
}

const toSessionSummary = (row: any): TailoringSessionSummary => ({
  id: row.id,
  resumeId: row.resumeId,
  jobDescriptionId: row.jobDescriptionId,
  status: row.status,
  savedResumeId: row.savedResumeId,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  jobTitle: row.jobTitle,
  companyName: row.companyName,
  resumeFilename: row.resumeFilename,
  versionNumber: Number(row.versionNumber),
  versionLabel: row.versionLabel,
});

export const getSession = async (sessionId: string, resumeId: string, userId: string): Promise<TailoringSessionDetail | null> => {
  const [rows]: any = await pool.execute(
    `SELECT ${SESSION_COLUMNS}, s.requirements_json as requirements, s.notes_json as notes
       ${SESSION_FROM}
      WHERE s.id = ? AND s.resume_id = ? AND s.user_id = ?`,
    [sessionId, resumeId, userId]
  );
  if (!rows[0]) return null;
  const [suggestions]: any = await pool.execute(
    `SELECT ${SUGGESTION_COLUMNS} FROM resume_tailoring_suggestions WHERE session_id = ? ORDER BY position`,
    [sessionId]
  );
  return {
    ...toSessionSummary(rows[0]),
    method: 'rule_based',
    requirements: parseJson<RequirementCoverage[]>(rows[0].requirements),
    notes: parseJson<TailoringNote[]>(rows[0].notes),
    suggestions: suggestions.map(toSuggestion),
  };
};

export type ReviewOutcome = { suggestion: TailoringSuggestion } | 'not_found' | 'saved';

// Records the user's decision on one suggestion of one of their draft sessions.
export const reviewSuggestion = async (
  sessionId: string,
  resumeId: string,
  suggestionId: string,
  userId: string,
  status: ReviewStatus,
  editedText: string | null
): Promise<ReviewOutcome> => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Locks the session so a review cannot interleave with saving it.
    const [sessions]: any = await connection.execute(
      'SELECT status FROM resume_tailoring_sessions WHERE id = ? AND resume_id = ? AND user_id = ? FOR UPDATE',
      [sessionId, resumeId, userId]
    );
    if (!sessions[0]) {
      await connection.rollback();
      return 'not_found';
    }
    if (sessions[0].status !== 'draft') {
      await connection.rollback();
      return 'saved';
    }
    const [updated]: any = await connection.execute(
      'UPDATE resume_tailoring_suggestions SET status = ?, edited_text = ? WHERE id = ? AND session_id = ?',
      [status, editedText, suggestionId, sessionId]
    );
    if (updated.affectedRows !== 1) {
      await connection.rollback();
      return 'not_found';
    }
    const [rows]: any = await connection.execute(`SELECT ${SUGGESTION_COLUMNS} FROM resume_tailoring_suggestions WHERE id = ?`, [suggestionId]);
    await connection.commit();
    return { suggestion: toSuggestion(rows[0]) };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// "cv.pdf" + "Backend Developer" -> "cv - tailored for Backend Developer.txt"
export const tailoredFilename = (sourceFilename: string, jobTitle: string) => {
  const base = sourceFilename.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[\\/\u0000-\u001f]/g, ' ').trim() || 'resume';
  const title = jobTitle.replace(/[\\/\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  return `${base.slice(0, 120)} - tailored for ${title.slice(0, 100)}.txt`;
};

export type SaveOutcome = { resumeId: string; created: boolean } | 'not_found' | 'nothing_accepted';

// Saves the tailored text as a new, non-current version of the source resume.
// Only an explicit request does this. It runs once per session: the session row
// is locked (reviews wait for it), the text is assembled from the decisions as
// they are at that moment, and a session that was already saved returns its
// existing copy. The text file is removed again if the transaction does not
// commit, so neither an orphaned file nor a version without its file is left.
export const saveTailoredCopy = async (
  sessionId: string,
  resumeId: string,
  userId: string,
  build: () => Promise<{ text: string; appliedCount: number; jobTitle: string; sourceFilename: string }>
): Promise<SaveOutcome> => {
  const connection = await pool.getConnection();
  let filePath: string | null = null;
  let committed = false;
  try {
    await beginVersionTransaction(connection);
    const [sessions]: any = await connection.execute(
      'SELECT saved_resume_id as savedResumeId FROM resume_tailoring_sessions WHERE id = ? AND resume_id = ? AND user_id = ? FOR UPDATE',
      [sessionId, resumeId, userId]
    );
    if (!sessions[0]) {
      await connection.rollback();
      return 'not_found';
    }
    if (sessions[0].savedResumeId) {
      await connection.rollback();
      return { resumeId: sessions[0].savedResumeId, created: false };
    }

    const { text, appliedCount, jobTitle, sourceFilename } = await build();
    if (appliedCount === 0) {
      await connection.rollback();
      return 'nothing_accepted';
    }

    const next = await reserveNextVersion(connection, resumeId, userId);
    if (!next) {
      await connection.rollback();
      return 'not_found';
    }
    const storedFilename = `${uuidv4()}.txt`;
    filePath = path.join(UPLOAD_DIR, storedFilename);
    await fs.promises.writeFile(filePath, text, { encoding: 'utf8', flag: 'wx' });

    const id = uuidv4();
    await connection.execute(
      `INSERT INTO resumes (id, user_id, resume_group_id, version_number, version_label, is_current, source_type,
         original_filename, stored_filename, file_path, file_size, mime_type, extraction_status, text_content)
       VALUES (?, ?, ?, ?, ?, 0, 'tailored', ?, ?, ?, ?, 'text/plain', 'completed', ?)`,
      [
        id,
        userId,
        next.groupId,
        next.versionNumber,
        `Tailored: ${jobTitle}`.slice(0, 100),
        tailoredFilename(sourceFilename, jobTitle),
        storedFilename,
        filePath,
        Buffer.byteLength(text, 'utf8'),
        text,
      ]
    );
    await connection.execute(
      "UPDATE resume_tailoring_sessions SET status = 'saved', saved_resume_id = ? WHERE id = ? AND user_id = ?",
      [id, sessionId, userId]
    );
    await connection.commit();
    committed = true;
    return { resumeId: id, created: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    if (filePath && !committed) await fs.promises.unlink(filePath).catch(() => {});
  }
};
