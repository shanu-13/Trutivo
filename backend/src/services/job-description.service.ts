import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import type { JobRequirements } from './ai.service';

// Every query is scoped to the owning user, so another user's record behaves
// exactly like one that does not exist.

export interface JobDescriptionInput {
  title: string;
  companyName: string | null;
  descriptionText: string;
}

const SUMMARY_COLUMNS =
  'id, title, company_name as companyName, created_at as createdAt, updated_at as updatedAt';
const DETAIL_COLUMNS = `${SUMMARY_COLUMNS}, description_text as descriptionText`;

// API field -> column, for the fields a user may change.
const UPDATABLE_COLUMNS: Record<keyof JobDescriptionInput, string> = {
  title: 'title',
  companyName: 'company_name',
  descriptionText: 'description_text',
};

export const createJobDescription = async (userId: string, input: JobDescriptionInput) => {
  const id = uuidv4();
  await pool.execute(
    'INSERT INTO job_descriptions (id, user_id, title, company_name, description_text) VALUES (?, ?, ?, ?, ?)',
    [id, userId, input.title, input.companyName, input.descriptionText]
  );
  return id;
};

// Includes when requirements were last extracted (null if they never were, or
// were discarded because the description text changed).
export const getUserJobDescriptions = async (userId: string) => {
  const [rows]: any = await pool.execute(
    `SELECT jd.id, jd.title, jd.company_name as companyName, jd.created_at as createdAt, jd.updated_at as updatedAt,
            jr.updated_at as requirementsExtractedAt
       FROM job_descriptions jd
       LEFT JOIN job_requirements jr ON jr.job_description_id = jd.id
      WHERE jd.user_id = ?
      ORDER BY jd.created_at DESC, jd.id`,
    [userId]
  );
  return rows;
};

export const getJobDescriptionById = async (id: string, userId: string) => {
  const [rows]: any = await pool.execute(
    `SELECT ${DETAIL_COLUMNS} FROM job_descriptions WHERE id = ? AND user_id = ?`,
    [id, userId]
  );
  return rows[0] || null;
};

// Returns false if the job description does not exist or belongs to another user.
// Changing the description text discards requirements extracted from the old text.
export const updateJobDescription = async (
  id: string,
  userId: string,
  changes: Partial<JobDescriptionInput>
) => {
  const assignments: string[] = [];
  const values: (string | null)[] = [];
  for (const [field, column] of Object.entries(UPDATABLE_COLUMNS) as [keyof JobDescriptionInput, string][]) {
    if (changes[field] !== undefined) {
      assignments.push(`${column} = ?`);
      values.push(changes[field] as string | null);
    }
  }
  // Set explicitly: ON UPDATE only fires when a value actually changes.
  assignments.push('updated_at = CURRENT_TIMESTAMP');

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows]: any = await connection.execute(
      'SELECT description_text as descriptionText FROM job_descriptions WHERE id = ? AND user_id = ? FOR UPDATE',
      [id, userId]
    );
    if (rows.length === 0) {
      await connection.rollback();
      return false;
    }

    await connection.execute(
      `UPDATE job_descriptions SET ${assignments.join(', ')} WHERE id = ? AND user_id = ?`,
      [...values, id, userId]
    );
    if (changes.descriptionText !== undefined && changes.descriptionText !== rows[0].descriptionText) {
      await connection.execute('DELETE FROM job_requirements WHERE job_description_id = ?', [id]);
    }

    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const deleteJobDescription = async (id: string, userId: string) => {
  const [result]: any = await pool.execute(
    'DELETE FROM job_descriptions WHERE id = ? AND user_id = ?',
    [id, userId]
  );
  return result.affectedRows > 0;
};

export type SaveRequirementsResult = 'saved' | 'not_found' | 'stale';

// Stores the requirements extracted from `sourceText`, replacing any earlier
// extraction. Nothing is saved if the job description no longer belongs to the
// user, or if its text changed while extraction was running.
export const saveJobRequirements = async (
  jobDescriptionId: string,
  userId: string,
  sourceText: string,
  requirements: JobRequirements
): Promise<SaveRequirementsResult> => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows]: any = await connection.execute(
      'SELECT description_text as descriptionText FROM job_descriptions WHERE id = ? AND user_id = ? FOR UPDATE',
      [jobDescriptionId, userId]
    );
    if (rows.length === 0) {
      await connection.rollback();
      return 'not_found';
    }
    if (rows[0].descriptionText !== sourceText) {
      await connection.rollback();
      return 'stale';
    }

    await connection.execute(
      `INSERT INTO job_requirements
         (id, job_description_id, location, employment_type, work_mode, required_skills, preferred_skills,
          mentioned_skills, experience_requirements, education_requirements, responsibilities)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) AS new
       ON DUPLICATE KEY UPDATE
         location = new.location,
         employment_type = new.employment_type,
         work_mode = new.work_mode,
         required_skills = new.required_skills,
         preferred_skills = new.preferred_skills,
         mentioned_skills = new.mentioned_skills,
         experience_requirements = new.experience_requirements,
         education_requirements = new.education_requirements,
         responsibilities = new.responsibilities,
         updated_at = CURRENT_TIMESTAMP`,
      [
        uuidv4(),
        jobDescriptionId,
        requirements.location,
        requirements.employmentType,
        requirements.workMode,
        JSON.stringify(requirements.requiredSkills),
        JSON.stringify(requirements.preferredSkills),
        JSON.stringify(requirements.mentionedSkills),
        JSON.stringify(requirements.experienceRequirements),
        JSON.stringify(requirements.educationRequirements),
        JSON.stringify(requirements.responsibilities),
      ]
    );

    await connection.commit();
    return 'saved';
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// Stored requirements for one of the user's job descriptions, or null if none
// have been extracted (or the job description is not the user's).
export const getJobRequirements = async (jobDescriptionId: string, userId: string) => {
  const [rows]: any = await pool.execute(
    `SELECT jr.location, jr.employment_type as employmentType, jr.work_mode as workMode,
            jr.required_skills as requiredSkills, jr.preferred_skills as preferredSkills,
            jr.mentioned_skills as mentionedSkills, jr.experience_requirements as experienceRequirements,
            jr.education_requirements as educationRequirements, jr.responsibilities,
            jr.updated_at as extractedAt
       FROM job_requirements jr
       JOIN job_descriptions jd ON jd.id = jr.job_description_id
      WHERE jr.job_description_id = ? AND jd.user_id = ?`,
    [jobDescriptionId, userId]
  );
  return rows[0] || null;
};
