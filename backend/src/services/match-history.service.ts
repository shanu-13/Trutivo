import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import type { MatchAnalysis, MatchingResult, ResumeRecommendations, SemanticMatch } from './ai.service';

// Saved match results (Step 8A). Every query is scoped to the owning user, so
// another user's record behaves exactly like one that does not exist.

export const SNAPSHOT_VERSION = 1;
// A complete snapshot is typically 10-30 KB; anything far larger is a bug, not a result.
export const MAX_SNAPSHOT_BYTES = 512 * 1024;

export interface MatchSnapshotParts {
  matching: MatchingResult;
  semanticMatch: SemanticMatch | null;
  semanticError: { code: string; message: string } | null;
  analysis: MatchAnalysis;
  recommendations: ResumeRecommendations;
}

// The stored result: the same keys the live match response uses, so the saved
// view renders it with the same components.
export interface MatchSnapshot extends MatchSnapshotParts {
  snapshotVersion: number;
}

export class SnapshotTooLargeError extends Error {}

// Contact details and filesystem paths have no place in a saved analysis. The
// structured results should not contain any, but strings derived from resume
// entries (role titles, project names) are scrubbed defensively.
// Quantifiers are bounded so long strings cannot cause catastrophic backtracking.
const EMAIL_RE = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}/g;
const PHONE_RE = /\+?\(?\d[\d\s().-]{8,18}\d/g;
const PATH_RE = /(?:\/(?:home|Users|srv|var|tmp|opt|etc|root|mnt|usr)\/[^\s"'<>]{0,500})|(?:\b[A-Za-z]:\\[^\s"'<>]{0,500})/g;
const REDACTED = '[redacted]';

const isPhoneNumber = (candidate: string) => {
  const digits = candidate.replace(/\D/g, '');
  // Runs of years ("2016 - 2020") are not phone numbers.
  const groups = candidate.match(/\d+/g) ?? [];
  return digits.length >= 10 && digits.length <= 15 && !groups.every((g) => /^(19|20)\d\d$/.test(g));
};

export const redactPersonalData = (text: string) =>
  text
    .replace(EMAIL_RE, REDACTED)
    .replace(PATH_RE, REDACTED)
    .replace(PHONE_RE, (match) => (isPhoneNumber(match) ? REDACTED : match));

const scrub = (value: unknown): unknown => {
  if (typeof value === 'string') return redactPersonalData(value);
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)]));
  }
  return value;
};

// Builds the snapshot from results that the AI-service client has already
// validated. It copies only these parts: no resume text, job text or file data.
export const buildMatchSnapshot = (parts: MatchSnapshotParts): MatchSnapshot => {
  const picked = {
    snapshotVersion: SNAPSHOT_VERSION,
    matching: parts.matching,
    semanticMatch: parts.semanticMatch,
    semanticError: parts.semanticError,
    analysis: parts.analysis,
    recommendations: parts.recommendations,
  };
  // Checked before scrubbing, so an oversized input is rejected without being scanned.
  if (Buffer.byteLength(JSON.stringify(picked), 'utf8') > MAX_SNAPSHOT_BYTES) {
    throw new SnapshotTooLargeError('Match snapshot is too large');
  }
  return scrub(picked) as MatchSnapshot;
};

// Saves a snapshot for one of the user's resumes and job descriptions. The
// ownership check and the labels come from the same statement, so nothing is
// saved if either record was deleted or is not the user's. Returns the new id,
// or null when nothing was saved.
export const saveMatchHistory = async (
  userId: string,
  resumeId: string,
  jobDescriptionId: string,
  snapshot: MatchSnapshot
): Promise<string | null> => {
  const id = uuidv4();
  const [result]: any = await pool.execute(
    `INSERT INTO resume_job_matches
       (id, user_id, resume_id, job_description_id, resume_filename_snapshot, job_title_snapshot,
        company_name_snapshot, overall_score, result_json)
     SELECT ?, r.user_id, r.id, jd.id, r.original_filename, jd.title, jd.company_name, ?, CAST(? AS JSON)
       FROM resumes r
       JOIN job_descriptions jd ON jd.user_id = r.user_id
      WHERE r.id = ? AND jd.id = ? AND r.user_id = ?`,
    [id, snapshot.matching.overallScore, JSON.stringify(snapshot), resumeId, jobDescriptionId, userId]
  );
  return result.affectedRows === 1 ? id : null;
};

export const toNumber = (value: unknown) => (value === null || value === undefined ? null : Number(value));

export const SUMMARY_COLUMNS = `id, resume_id as resumeId, job_description_id as jobDescriptionId,
  resume_filename_snapshot as resumeFilename, job_title_snapshot as jobTitle,
  company_name_snapshot as companyName, overall_score as overallScore, created_at as createdAt`;

export const toSummary = (row: any) => ({
  id: row.id,
  resumeId: row.resumeId,
  jobDescriptionId: row.jobDescriptionId,
  resumeFilename: row.resumeFilename,
  jobTitle: row.jobTitle,
  companyName: row.companyName,
  overallScore: toNumber(row.overallScore),
  createdAt: row.createdAt,
});

export type MatchHistorySummary = ReturnType<typeof toSummary>;

// One page of the user's history, newest first, without the snapshots.
export const listMatchHistory = async (userId: string, page: number, limit: number) => {
  const [countRows]: any = await pool.execute('SELECT COUNT(*) as total FROM resume_job_matches WHERE user_id = ?', [
    userId,
  ]);
  // query() rather than execute(): MySQL prepared statements reject LIMIT/OFFSET
  // placeholders bound as numbers. Values are escaped by the driver either way.
  const [rows]: any = await pool.query(
    `SELECT ${SUMMARY_COLUMNS} FROM resume_job_matches
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?`,
    [userId, limit, (page - 1) * limit]
  );
  return { items: rows.map(toSummary) as MatchHistorySummary[], total: Number(countRows[0].total) };
};

export const getMatchHistory = async (id: string, userId: string) => {
  const [rows]: any = await pool.execute(
    `SELECT ${SUMMARY_COLUMNS}, result_json as result FROM resume_job_matches WHERE id = ? AND user_id = ?`,
    [id, userId]
  );
  if (!rows[0]) return null;
  const result = typeof rows[0].result === 'string' ? JSON.parse(rows[0].result) : rows[0].result;
  return { ...toSummary(rows[0]), result: result as MatchSnapshot };
};

export const deleteMatchHistory = async (id: string, userId: string) => {
  const [result]: any = await pool.execute('DELETE FROM resume_job_matches WHERE id = ? AND user_id = ?', [id, userId]);
  return result.affectedRows > 0;
};

// The latest-first saved scores of two of the user's resumes, for comparing
// versions. Only valid official scores (0-100) are returned.
export const getSavedScoresForResumes = async (userId: string, resumeIds: [string, string]) => {
  const [rows]: any = await pool.execute(
    `SELECT id, resume_id as resumeId, job_description_id as jobDescriptionId, job_title_snapshot as jobTitle,
            company_name_snapshot as companyName, overall_score as overallScore, created_at as createdAt
       FROM resume_job_matches
      WHERE user_id = ? AND resume_id IN (?, ?) AND overall_score IS NOT NULL AND overall_score BETWEEN 0 AND 100
      ORDER BY created_at DESC, id DESC`,
    [userId, ...resumeIds]
  );
  return rows.map((row: any) => ({ ...row, overallScore: Number(row.overallScore) }));
};
