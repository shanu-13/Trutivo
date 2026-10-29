import { v4 as uuidv4 } from 'uuid';
import type { PoolConnection } from 'mysql2/promise';
import pool from '../config/database';

// Job application tracker (Step 13). Every query is scoped to the signed-in
// user, so another user's application behaves exactly like one that does not
// exist. History is written by the server in the same transaction as the
// change it records, and never deleted by later changes.

export const APPLICATION_STATUSES = ['wishlist', 'preparing', 'applied', 'assessment', 'interview', 'offer', 'rejected', 'withdrawn'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'internship', 'temporary', 'freelance', 'other'] as const;
export const INTERVIEW_TYPES = ['phone', 'video', 'in_person', 'other'] as const;

// Statuses after which the application has been sent; "withdrawn" counts only if an application date was entered.
export const SUBMITTED_STATUSES: readonly ApplicationStatus[] = ['applied', 'assessment', 'interview', 'offer', 'rejected'];
// Finished applications need no follow-up.
export const CLOSED_STATUSES: readonly ApplicationStatus[] = ['offer', 'rejected', 'withdrawn'];

export interface ApplicationFields {
  jobTitle: string;
  companyName: string;
  postingUrl: string | null;
  status: ApplicationStatus;
  appliedOn: string | null; // YYYY-MM-DD as entered
  location: string | null;
  employmentType: (typeof EMPLOYMENT_TYPES)[number] | null;
  compensationNotes: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
  interviewAt: string | null; // ISO 8601 UTC
  interviewType: (typeof INTERVIEW_TYPES)[number] | null;
  interviewStage: string | null;
  interviewerName: string | null;
  interviewNotes: string | null;
  followUpOn: string | null; // YYYY-MM-DD
  followUpNotes: string | null;
  jobDescriptionId: string | null;
  resumeId: string | null;
  coverLetterId: string | null;
}

type Field = keyof ApplicationFields;

const COLUMN: Record<Field, string> = {
  jobTitle: 'job_title',
  companyName: 'company_name',
  postingUrl: 'posting_url',
  status: 'status',
  appliedOn: 'applied_on',
  location: 'location',
  employmentType: 'employment_type',
  compensationNotes: 'compensation_notes',
  contactName: 'contact_name',
  contactEmail: 'contact_email',
  contactPhone: 'contact_phone',
  notes: 'notes',
  interviewAt: 'interview_at',
  interviewType: 'interview_type',
  interviewStage: 'interview_stage',
  interviewerName: 'interviewer_name',
  interviewNotes: 'interview_notes',
  followUpOn: 'follow_up_on',
  followUpNotes: 'follow_up_notes',
  jobDescriptionId: 'job_description_id',
  resumeId: 'resume_id',
  coverLetterId: 'cover_letter_id',
};
const FIELDS = Object.keys(COLUMN) as Field[];

// ISO "2026-11-02T09:30:00.000Z" -> "2026-11-02 09:30:00" (UTC) for the DATETIME column.
const toSqlUtc = (iso: string) => new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
type SqlValue = string | number | null;
const toSql = (field: Field, value: unknown): SqlValue =>
  field === 'interviewAt' && typeof value === 'string' ? toSqlUtc(value) : ((value ?? null) as SqlValue);

// Dates leave the database as plain strings, so no time-zone conversion can shift them.
const SELECT_FIELDS = `a.id, a.job_title as jobTitle, a.company_name as companyName, a.posting_url as postingUrl, a.status,
  DATE_FORMAT(a.applied_on, '%Y-%m-%d') as appliedOn, a.location, a.employment_type as employmentType,
  a.compensation_notes as compensationNotes, a.contact_name as contactName, a.contact_email as contactEmail,
  a.contact_phone as contactPhone, a.notes, DATE_FORMAT(a.interview_at, '%Y-%m-%dT%H:%i:%sZ') as interviewAt,
  a.interview_type as interviewType, a.interview_stage as interviewStage, a.interviewer_name as interviewerName,
  a.interview_notes as interviewNotes, DATE_FORMAT(a.follow_up_on, '%Y-%m-%d') as followUpOn,
  a.follow_up_notes as followUpNotes, a.job_description_id as jobDescriptionId, a.resume_id as resumeId,
  a.cover_letter_id as coverLetterId, a.created_at as createdAt, a.updated_at as updatedAt`;
// Labels of linked records, only when they are still the same user's.
const SELECT_LINKS = `jd.title as jobDescriptionTitle, r.original_filename as resumeFilename, r.version_number as resumeVersionNumber,
  cl.title as coverLetterTitle`;
const FROM = `FROM job_applications a
  LEFT JOIN job_descriptions jd ON jd.id = a.job_description_id AND jd.user_id = a.user_id
  LEFT JOIN resumes r ON r.id = a.resume_id AND r.user_id = a.user_id
  LEFT JOIN cover_letters cl ON cl.id = a.cover_letter_id AND cl.user_id = a.user_id`;

const today = () => new Date().toISOString().slice(0, 10);

// The next dated action: an interview still ahead, or a follow-up on or after `asOf`.
const nextAction = (row: any, asOf: string) => {
  const options: { type: 'interview' | 'follow_up'; at: string; sort: string }[] = [];
  if (row.interviewAt && row.interviewAt >= new Date().toISOString().slice(0, 19) + 'Z') options.push({ type: 'interview', at: row.interviewAt, sort: row.interviewAt });
  if (row.followUpOn && row.followUpOn >= asOf) options.push({ type: 'follow_up', at: row.followUpOn, sort: `${row.followUpOn}T00:00:00Z` });
  options.sort((a, b) => a.sort.localeCompare(b.sort));
  return options[0] ? { type: options[0].type, at: options[0].at } : null;
};

const toApplication = (row: any, asOf: string) => {
  const app = {} as ApplicationFields & {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    links: {
      jobDescription: { id: string; title: string } | null;
      resume: { id: string; filename: string; versionNumber: number } | null;
      coverLetter: { id: string; title: string } | null;
    };
    nextAction: ReturnType<typeof nextAction>;
    followUpDue: boolean;
  };
  app.id = row.id;
  for (const f of FIELDS) (app as any)[f] = row[f] ?? null;
  app.createdAt = row.createdAt;
  app.updatedAt = row.updatedAt;
  app.links = {
    jobDescription: row.jobDescriptionId && row.jobDescriptionTitle ? { id: row.jobDescriptionId, title: row.jobDescriptionTitle } : null,
    resume: row.resumeId && row.resumeFilename ? { id: row.resumeId, filename: row.resumeFilename, versionNumber: Number(row.resumeVersionNumber) } : null,
    coverLetter: row.coverLetterId && row.coverLetterTitle ? { id: row.coverLetterId, title: row.coverLetterTitle } : null,
  };
  app.nextAction = nextAction(row, asOf);
  app.followUpDue = Boolean(row.followUpOn && row.followUpOn <= asOf && !CLOSED_STATUSES.includes(row.status));
  return app;
};

export type Application = ReturnType<typeof toApplication>;

type Queryable = Pick<PoolConnection, 'execute'>;

// The first linked id that is not the user's, or null when all are fine.
const invalidLink = async (db: Queryable, userId: string, values: Partial<ApplicationFields>): Promise<Field | null> => {
  const checks: [Field, string][] = [
    ['jobDescriptionId', 'SELECT 1 FROM job_descriptions WHERE id = ? AND user_id = ?'],
    ['resumeId', 'SELECT 1 FROM resumes WHERE id = ? AND user_id = ?'],
    ['coverLetterId', 'SELECT 1 FROM cover_letters WHERE id = ? AND user_id = ?'],
  ];
  for (const [field, sql] of checks) {
    const id = values[field];
    if (!id) continue;
    const [rows]: any = await db.execute(sql, [id, userId]);
    if (rows.length === 0) return field;
  }
  return null;
};

const addEvent = (db: Queryable, applicationId: string, userId: string, type: string, extra: { from?: string | null; to?: string | null; details?: unknown } = {}) =>
  db.execute(
    'INSERT INTO job_application_events (id, application_id, user_id, event_type, from_status, to_status, details) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [uuidv4(), applicationId, userId, type, extra.from ?? null, extra.to ?? null, extra.details === undefined ? null : JSON.stringify(extra.details)]
  );

const transaction = async <T>(work: (db: PoolConnection) => Promise<T>) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export type WriteResult = { id: string } | { invalidLink: Field } | 'not_found';

export const createApplication = (userId: string, values: ApplicationFields): Promise<WriteResult> =>
  transaction(async (db) => {
    const bad = await invalidLink(db, userId, values);
    if (bad) return { invalidLink: bad };
    const id = uuidv4();
    await db.execute(
      `INSERT INTO job_applications (id, user_id, ${FIELDS.map((f) => COLUMN[f]).join(', ')}) VALUES (?, ?, ${FIELDS.map(() => '?').join(', ')})`,
      [id, userId, ...FIELDS.map((f) => toSql(f, values[f]))]
    );
    await addEvent(db, id, userId, 'created', { to: values.status });
    if (values.interviewAt) await addEvent(db, id, userId, 'interview_scheduled', { details: { interviewAt: values.interviewAt, interviewType: values.interviewType } });
    if (values.followUpOn) await addEvent(db, id, userId, 'follow_up_set', { details: { followUpOn: values.followUpOn } });
    return { id };
  });

const INTERVIEW_FIELDS: Field[] = ['interviewAt', 'interviewType', 'interviewStage', 'interviewerName'];
const HISTORY_OWN_FIELDS: Field[] = ['status', 'interviewAt', 'interviewType', 'interviewStage', 'interviewerName', 'followUpOn'];

// Applies the changes and records each meaningful change in the history.
export const updateApplication = (userId: string, id: string, changes: Partial<ApplicationFields>): Promise<WriteResult> =>
  transaction(async (db) => {
    const [rows]: any = await db.execute(`SELECT ${SELECT_FIELDS} FROM job_applications a WHERE a.id = ? AND a.user_id = ? FOR UPDATE`, [id, userId]);
    const current = rows[0];
    if (!current) return 'not_found';
    const changed = (Object.keys(changes) as Field[]).filter((f) => changes[f] !== undefined && (changes[f] ?? null) !== (current[f] ?? null));
    if (changed.length === 0) return { id };
    const bad = await invalidLink(db, userId, Object.fromEntries(changed.map((f) => [f, changes[f]])));
    if (bad) return { invalidLink: bad };

    await db.execute(
      `UPDATE job_applications SET ${changed.map((f) => `${COLUMN[f]} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND user_id = ?`,
      [...changed.map((f) => toSql(f, changes[f])), id, userId]
    );

    if (changed.includes('status')) await addEvent(db, id, userId, 'status_changed', { from: current.status, to: changes.status! });
    if (changed.some((f) => INTERVIEW_FIELDS.includes(f))) {
      const next = { ...current, ...Object.fromEntries(changed.map((f) => [f, changes[f]])) };
      const type = !current.interviewAt && next.interviewAt ? 'interview_scheduled' : current.interviewAt && !next.interviewAt ? 'interview_cleared' : 'interview_updated';
      await addEvent(db, id, userId, type, { details: { interviewAt: next.interviewAt ?? null, interviewType: next.interviewType ?? null, interviewStage: next.interviewStage ?? null } });
    }
    if (changed.includes('followUpOn')) {
      await addEvent(db, id, userId, changes.followUpOn ? 'follow_up_set' : 'follow_up_cleared', { details: { followUpOn: changes.followUpOn ?? null } });
    }
    const other = changed.filter((f) => !HISTORY_OWN_FIELDS.includes(f));
    // Only the names of edited fields: notes and contact details stay out of the history.
    if (other.length) await addEvent(db, id, userId, 'details_updated', { details: { fields: other } });
    return { id };
  });

export const getApplication = async (id: string, userId: string, asOf = today()) => {
  const [rows]: any = await pool.execute(`SELECT ${SELECT_FIELDS}, ${SELECT_LINKS} ${FROM} WHERE a.id = ? AND a.user_id = ?`, [id, userId]);
  return rows[0] ? toApplication(rows[0], asOf) : null;
};

export const getHistory = async (id: string, userId: string) => {
  const [rows]: any = await pool.execute(
    `SELECT e.id, e.event_type as type, e.from_status as fromStatus, e.to_status as toStatus, e.details, e.created_at as createdAt
       FROM job_application_events e JOIN job_applications a ON a.id = e.application_id
      WHERE e.application_id = ? AND a.user_id = ? AND e.user_id = ?
      ORDER BY e.seq`,
    [id, userId, userId]
  );
  return rows.map((r: any) => ({ ...r, details: typeof r.details === 'string' ? JSON.parse(r.details) : r.details }));
};

// Its reminders are kept, unlinked and marked so the user can see why (Step 14).
export const deleteApplication = (id: string, userId: string) =>
  transaction(async (db) => {
    await db.execute('UPDATE reminders SET application_removed = 1 WHERE application_id = ? AND user_id = ?', [id, userId]);
    const [result]: any = await db.execute('DELETE FROM job_applications WHERE id = ? AND user_id = ?', [id, userId]);
    return result.affectedRows > 0;
  });

export const SORTS = {
  updated: 'a.updated_at',
  applied: 'a.applied_on',
  company: 'a.company_name',
  upcoming: 'next_at',
} as const;
export type SortKey = keyof typeof SORTS;

export interface ListQuery {
  statuses: ApplicationStatus[];
  company: string | null;
  title: string | null;
  appliedFrom: string | null;
  appliedTo: string | null;
  sort: SortKey;
  order: 'asc' | 'desc';
  page: number;
  limit: number;
  asOf: string;
}

const likeTerm = (term: string) => `%${term.replace(/[\\%_]/g, '\\$&')}%`;

export const listApplications = async (userId: string, q: ListQuery) => {
  const where = ['a.user_id = ?'];
  const params: SqlValue[] = [userId];
  if (q.statuses.length) {
    where.push(`a.status IN (${q.statuses.map(() => '?').join(', ')})`);
    params.push(...q.statuses);
  }
  if (q.company) {
    where.push('a.company_name LIKE ?');
    params.push(likeTerm(q.company));
  }
  if (q.title) {
    where.push('a.job_title LIKE ?');
    params.push(likeTerm(q.title));
  }
  if (q.appliedFrom) {
    where.push('a.applied_on >= ?');
    params.push(q.appliedFrom);
  }
  if (q.appliedTo) {
    where.push('a.applied_on <= ?');
    params.push(q.appliedTo);
  }
  // The next interview still ahead or follow-up from asOf on; applications without one sort last.
  const nextAt = `LEAST(
      COALESCE(CASE WHEN a.interview_at >= UTC_TIMESTAMP() THEN a.interview_at END, '9999-12-31 00:00:00'),
      COALESCE(CASE WHEN a.follow_up_on >= ? THEN CAST(a.follow_up_on AS DATETIME) END, '9999-12-31 00:00:00'))`;
  const direction = q.order === 'asc' ? 'ASC' : 'DESC';
  // Applications without the sorted value go last whichever way the list is sorted.
  const nullsLast = q.sort === 'applied' ? 'a.applied_on IS NULL, ' : '';
  const orderBy = `${nullsLast}${SORTS[q.sort]} ${direction}, a.updated_at DESC, a.id DESC`;

  const [countRows]: any = await pool.execute(`SELECT COUNT(*) as total FROM job_applications a WHERE ${where.join(' AND ')}`, params);
  // query() rather than execute(): MySQL prepared statements reject LIMIT/OFFSET placeholders.
  const [rows]: any = await pool.query(
    `SELECT ${SELECT_FIELDS}, ${SELECT_LINKS}, ${nextAt} as next_at ${FROM}
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?`,
    [q.asOf, ...params, q.limit, (q.page - 1) * q.limit]
  );
  const total = Number(countRows[0].total);
  return {
    items: rows.map((r: any) => toApplication(r, q.asOf)) as Application[],
    pagination: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
  };
};

// Summary counts, each application counted at most once per metric.
export const getMetrics = async (userId: string, asOf = today()) => {
  const submitted = SUBMITTED_STATUSES.map(() => '?').join(', ');
  const closed = CLOSED_STATUSES.map(() => '?').join(', ');
  const [rows]: any = await pool.execute(
    `SELECT COUNT(*) as total,
            COUNT(CASE WHEN status IN (${submitted}) OR (status = 'withdrawn' AND applied_on IS NOT NULL) THEN 1 END) as submitted,
            COUNT(CASE WHEN interview_at >= UTC_TIMESTAMP() THEN 1 END) as upcomingInterviews,
            COUNT(CASE WHEN status = 'offer' THEN 1 END) as offers,
            COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejections,
            COUNT(CASE WHEN follow_up_on IS NOT NULL AND follow_up_on <= ? AND status NOT IN (${closed}) THEN 1 END) as followUpsDue
       FROM job_applications WHERE user_id = ?`,
    [...SUBMITTED_STATUSES, asOf, ...CLOSED_STATUSES, userId]
  );
  const [byStatusRows]: any = await pool.execute('SELECT status, COUNT(*) as n FROM job_applications WHERE user_id = ? GROUP BY status', [userId]);
  const byStatus = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, 0])) as Record<ApplicationStatus, number>;
  for (const r of byStatusRows) byStatus[r.status as ApplicationStatus] = Number(r.n);
  const m = rows[0];
  return {
    asOf,
    total: Number(m.total),
    submitted: Number(m.submitted),
    upcomingInterviews: Number(m.upcomingInterviews),
    offers: Number(m.offers),
    rejections: Number(m.rejections),
    followUpsDue: Number(m.followUpsDue),
    byStatus,
  };
};
