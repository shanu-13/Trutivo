import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import { RULES_VERSION, type AtsResult } from './ats-readiness.service';

// Stored ATS readiness results (Step 11), one row per run, scoped to the user
// and to one resume version.

export const textFingerprint = (text: string) => crypto.createHash('sha256').update(text).digest('hex');

export const saveAtsCheck = async (userId: string, resumeId: string, text: string, result: AtsResult) => {
  const id = uuidv4();
  // INSERT ... SELECT: nothing is stored unless the resume is this user's.
  const [inserted]: any = await pool.execute(
    `INSERT INTO resume_ats_checks (id, user_id, resume_id, score, band, complete, rules_version, text_sha256, result_json)
     SELECT ?, r.user_id, r.id, ?, ?, ?, ?, ?, CAST(? AS JSON) FROM resumes r WHERE r.id = ? AND r.user_id = ?`,
    [id, result.score, result.band?.id ?? null, result.complete ? 1 : 0, result.rulesVersion, textFingerprint(text), JSON.stringify(result), resumeId, userId]
  );
  return inserted.affectedRows === 1 ? id : null;
};

export interface StoredAtsCheck {
  id: string;
  createdAt: Date;
  // The result no longer describes the resume: its text or the rules changed since.
  stale: boolean;
  result: AtsResult;
}

const parse = (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value) as AtsResult;

// The latest result and a short history for one of the user's resumes.
export const getAtsChecks = async (resumeId: string, userId: string, currentText: string | null) => {
  const [rows]: any = await pool.execute(
    `SELECT id, score, band, complete, rules_version as rulesVersion, text_sha256 as textSha, created_at as createdAt
       FROM resume_ats_checks WHERE resume_id = ? AND user_id = ?
      ORDER BY created_at DESC, id DESC LIMIT 10`,
    [resumeId, userId]
  );
  const current = currentText === null ? null : textFingerprint(currentText);
  const isStale = (row: any) => row.rulesVersion !== RULES_VERSION || row.textSha !== current;
  let latest: StoredAtsCheck | null = null;
  if (rows[0]) {
    const [full]: any = await pool.execute('SELECT result_json as result FROM resume_ats_checks WHERE id = ? AND user_id = ?', [rows[0].id, userId]);
    latest = { id: rows[0].id, createdAt: rows[0].createdAt, stale: isStale(rows[0]), result: parse(full[0].result) };
  }
  return {
    latest,
    history: rows.map((row: any) => ({
      id: row.id,
      score: row.score === null ? null : Number(row.score),
      band: row.band,
      complete: Number(row.complete) === 1,
      stale: isStale(row),
      createdAt: row.createdAt,
    })),
  };
};
