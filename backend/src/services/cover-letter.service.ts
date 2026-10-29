import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import type { CoverLetterLength, CoverLetterTone } from './ai.service';

// Saved cover letters (Step 12). Every query is scoped to the signed-in user,
// so another user's letter behaves exactly like one that does not exist.

export interface CoverLetterInput {
  title: string;
  roleTitle: string | null;
  companyName: string | null;
  content: string;
  tone: CoverLetterTone;
  length: CoverLetterLength;
}

const COLUMNS = `c.id, c.resume_id as resumeId, c.job_description_id as jobDescriptionId, c.title,
  c.role_title as roleTitle, c.company_name as companyName, c.tone, c.length,
  c.created_at as createdAt, c.updated_at as updatedAt,
  r.original_filename as resumeFilename, r.version_number as resumeVersionNumber, jd.title as jobTitle`;
const FROM = `FROM cover_letters c
  LEFT JOIN resumes r ON r.id = c.resume_id AND r.user_id = c.user_id
  LEFT JOIN job_descriptions jd ON jd.id = c.job_description_id AND jd.user_id = c.user_id`;

const toSummary = (row: any) => ({
  id: row.id as string,
  title: row.title as string,
  roleTitle: row.roleTitle as string | null,
  companyName: row.companyName as string | null,
  tone: row.tone as CoverLetterTone,
  length: row.length as CoverLetterLength,
  // null when the source was deleted (or never set).
  resume: row.resumeId ? { id: row.resumeId as string, filename: row.resumeFilename as string, versionNumber: Number(row.resumeVersionNumber) } : null,
  jobDescription: row.jobDescriptionId ? { id: row.jobDescriptionId as string, title: row.jobTitle as string } : null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export type CoverLetterSummary = ReturnType<typeof toSummary>;

// Stores a letter. The referenced resume and job description (each optional)
// must be the user's: they are checked in the same statement, and nothing is
// stored otherwise. Returns the new id, or null.
export const createCoverLetter = async (
  userId: string,
  input: CoverLetterInput,
  resumeId: string | null,
  jobDescriptionId: string | null
): Promise<string | null> => {
  const id = uuidv4();
  const [result]: any = await pool.execute(
    `INSERT INTO cover_letters (id, user_id, resume_id, job_description_id, title, role_title, company_name, content, tone, length)
     SELECT ?, u.id, ?, ?, ?, ?, ?, ?, ?, ?
       FROM users u
      WHERE u.id = ?
        AND (? IS NULL OR EXISTS (SELECT 1 FROM resumes r WHERE r.id = ? AND r.user_id = u.id))
        AND (? IS NULL OR EXISTS (SELECT 1 FROM job_descriptions jd WHERE jd.id = ? AND jd.user_id = u.id))`,
    [
      id,
      resumeId,
      jobDescriptionId,
      input.title,
      input.roleTitle,
      input.companyName,
      input.content,
      input.tone,
      input.length,
      userId,
      resumeId,
      resumeId,
      jobDescriptionId,
      jobDescriptionId,
    ]
  );
  return result.affectedRows === 1 ? id : null;
};

export const listCoverLetters = async (userId: string) => {
  const [rows]: any = await pool.execute(`SELECT ${COLUMNS} ${FROM} WHERE c.user_id = ? ORDER BY c.updated_at DESC, c.id DESC`, [userId]);
  return rows.map(toSummary) as CoverLetterSummary[];
};

export const getCoverLetter = async (id: string, userId: string) => {
  const [rows]: any = await pool.execute(`SELECT ${COLUMNS}, c.content ${FROM} WHERE c.id = ? AND c.user_id = ?`, [id, userId]);
  return rows[0] ? { ...toSummary(rows[0]), content: rows[0].content as string } : null;
};

const UPDATABLE: Record<keyof CoverLetterInput, string> = {
  title: 'title',
  roleTitle: 'role_title',
  companyName: 'company_name',
  content: 'content',
  tone: 'tone',
  length: 'length',
};

// Returns false if the letter does not exist or is not the user's.
export const updateCoverLetter = async (id: string, userId: string, changes: Partial<CoverLetterInput>) => {
  const assignments: string[] = [];
  const values: (string | null)[] = [];
  for (const [field, column] of Object.entries(UPDATABLE) as [keyof CoverLetterInput, string][]) {
    if (changes[field] !== undefined) {
      assignments.push(`${column} = ?`);
      values.push(changes[field] as string | null);
    }
  }
  assignments.push('updated_at = CURRENT_TIMESTAMP(3)');
  const [result]: any = await pool.execute(`UPDATE cover_letters SET ${assignments.join(', ')} WHERE id = ? AND user_id = ?`, [
    ...values,
    id,
    userId,
  ]);
  return result.affectedRows > 0;
};

export const deleteCoverLetter = async (id: string, userId: string) => {
  const [result]: any = await pool.execute('DELETE FROM cover_letters WHERE id = ? AND user_id = ?', [id, userId]);
  return result.affectedRows > 0;
};
