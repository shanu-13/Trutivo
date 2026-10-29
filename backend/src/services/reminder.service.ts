import { v4 as uuidv4 } from 'uuid';
import type { PoolConnection } from 'mysql2/promise';
import pool from '../config/database';
import { CLOSED_STATUSES, type ApplicationStatus } from './job-application.service';
import { localDate, localToUtc, toLocal } from '../utils/time-zone';

// Reminders (Step 14). Delivered in the app only: a reminder is "delivered" by
// being listed, so reading never changes anything and nothing is sent twice.
// Every query is scoped to the signed-in user; a reminder can only be linked to
// one of that user's own applications.

export const REMINDER_TYPES = ['follow_up', 'interview', 'assessment', 'recruiter_contact', 'custom'] as const;
export type ReminderType = (typeof REMINDER_TYPES)[number];
export const REMINDER_STATUSES = ['pending', 'completed', 'dismissed'] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];
export const VIEWS = ['upcoming', 'overdue', 'pending', 'completed', 'dismissed', 'all'] as const;
export type View = (typeof VIEWS)[number];

// Lead times offered for interview suggestions, in minutes.
export const INTERVIEW_LEADS = [0, 60, 180, 1440, 2880] as const;
export const TITLE_MAX = 200;

export interface ReminderInput {
  type: ReminderType;
  title: string;
  notes: string | null;
  dueLocal: string; // "YYYY-MM-DDTHH:mm" in timeZone
  timeZone: string;
  applicationId: string | null;
}

// Why a pending reminder may no longer be relevant (it is never changed or deleted automatically).
export type OutdatedReason = 'application_deleted' | 'application_closed' | 'interview_changed' | 'follow_up_changed';

const SELECT = `SELECT r.id, r.reminder_type as type, r.title, r.notes, DATE_FORMAT(r.due_at, '%Y-%m-%dT%H:%i:%sZ') as dueAt,
    r.time_zone as timeZone, r.status, r.completed_at as completedAt, r.dismissed_at as dismissedAt, r.source,
    r.source_key as sourceKey, r.application_removed as applicationRemoved, r.created_at as createdAt, r.updated_at as updatedAt,
    a.id as applicationId, a.job_title as jobTitle, a.company_name as companyName, a.status as applicationStatus,
    DATE_FORMAT(a.interview_at, '%Y-%m-%dT%H:%i:%sZ') as interviewAt, DATE_FORMAT(a.follow_up_on, '%Y-%m-%d') as followUpOn
  FROM reminders r
  LEFT JOIN job_applications a ON a.id = r.application_id AND a.user_id = r.user_id`;

const outdatedReason = (row: any): OutdatedReason | null => {
  if (row.status !== 'pending') return null;
  if (Number(row.applicationRemoved)) return 'application_deleted';
  if (!row.applicationId) return null;
  if (CLOSED_STATUSES.includes(row.applicationStatus)) return 'application_closed';
  if (row.source === 'application_interview' && row.sourceKey !== `interview:${row.interviewAt}`) return 'interview_changed';
  if (row.source === 'application_follow_up' && row.sourceKey !== `follow_up:${row.followUpOn}`) return 'follow_up_changed';
  return null;
};

const toReminder = (row: any, now: number) => {
  const due = Date.parse(row.dueAt);
  return {
    id: row.id as string,
    type: row.type as ReminderType,
    title: row.title as string,
    notes: (row.notes ?? null) as string | null,
    dueAt: row.dueAt as string,
    timeZone: row.timeZone as string,
    // The due time as the user entered it, in the reminder's own time zone.
    dueLocal: toLocal(due, row.timeZone),
    status: row.status as ReminderStatus,
    overdue: row.status === 'pending' && due < now,
    completedAt: row.completedAt as Date | null,
    dismissedAt: row.dismissedAt as Date | null,
    source: row.source as 'manual' | 'application_interview' | 'application_follow_up',
    application: row.applicationId
      ? { id: row.applicationId as string, jobTitle: row.jobTitle as string, companyName: row.companyName as string, status: row.applicationStatus as ApplicationStatus }
      : null,
    applicationRemoved: Boolean(Number(row.applicationRemoved)),
    mayBeOutdated: outdatedReason(row),
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
};
export type Reminder = ReturnType<typeof toReminder>;

type Queryable = Pick<PoolConnection, 'execute'>;

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

const ownsApplication = async (db: Queryable, userId: string, applicationId: string) => {
  const [rows]: any = await db.execute('SELECT 1 FROM job_applications WHERE id = ? AND user_id = ?', [applicationId, userId]);
  return rows.length > 0;
};

const toSqlUtc = (iso: string) => iso.slice(0, 19).replace('T', ' ');

export type WriteResult = { id: string } | 'not_found' | 'application_not_found' | 'nonexistent_time' | 'in_past';

// A new due time may be up to this far in the past (the minute being typed in).
const PAST_SLACK_MS = 60_000;

export const getReminder = async (userId: string, id: string, now = Date.now()) => {
  const [rows]: any = await pool.execute(`${SELECT} WHERE r.id = ? AND r.user_id = ?`, [id, userId]);
  return rows[0] ? toReminder(rows[0], now) : null;
};

export const createReminder = (userId: string, input: ReminderInput, now = Date.now()): Promise<WriteResult> =>
  transaction(async (db) => {
    const due = localToUtc(input.dueLocal, input.timeZone);
    if (!due.ok) return 'nonexistent_time';
    if (Date.parse(due.utc) < now - PAST_SLACK_MS) return 'in_past';
    if (input.applicationId && !(await ownsApplication(db, userId, input.applicationId))) return 'application_not_found';
    const id = uuidv4();
    await db.execute(
      `INSERT INTO reminders (id, user_id, application_id, reminder_type, title, notes, due_at, time_zone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, input.applicationId, input.type, input.title, input.notes, toSqlUtc(due.utc), input.timeZone]
    );
    return { id };
  });

// Any subset of the fields. A new date or time zone is combined with the stored
// other half, so changing only the time zone keeps the same local time. An
// unchanged due time may be in the past (editing the text of an overdue reminder).
export const updateReminder = (userId: string, id: string, changes: Partial<ReminderInput>, now = Date.now()): Promise<WriteResult> =>
  transaction(async (db) => {
    const [rows]: any = await db.execute(
      `SELECT application_id as applicationId, DATE_FORMAT(due_at, '%Y-%m-%dT%H:%i:%sZ') as dueAt, time_zone as timeZone
         FROM reminders WHERE id = ? AND user_id = ? FOR UPDATE`,
      [id, userId]
    );
    const current = rows[0];
    if (!current) return 'not_found';
    const sets: string[] = [];
    const params: (string | null)[] = [];
    const set = (column: string, value: string | null) => {
      sets.push(`${column} = ?`);
      params.push(value);
    };
    if (changes.type !== undefined) set('reminder_type', changes.type);
    if (changes.title !== undefined) set('title', changes.title);
    if (changes.notes !== undefined) set('notes', changes.notes);
    const currentLocal = toLocal(Date.parse(current.dueAt), current.timeZone);
    const timeZone = changes.timeZone ?? current.timeZone;
    const dueLocal = changes.dueLocal ?? currentLocal;
    // Re-sending the same local time and zone leaves due_at alone (it may be the second of a repeated hour).
    if (dueLocal !== currentLocal || timeZone !== current.timeZone) {
      const due = localToUtc(dueLocal, timeZone);
      if (!due.ok) return 'nonexistent_time';
      if (Date.parse(due.utc) !== Date.parse(current.dueAt) && Date.parse(due.utc) < now - PAST_SLACK_MS) return 'in_past';
      set('due_at', toSqlUtc(due.utc));
      set('time_zone', timeZone);
    }
    if (changes.applicationId !== undefined && changes.applicationId !== current.applicationId) {
      if (changes.applicationId && !(await ownsApplication(db, userId, changes.applicationId))) return 'application_not_found';
      set('application_id', changes.applicationId);
      // Linked by hand to another application: no longer tied to the original interview or follow-up.
      sets.push("source = 'manual'", 'source_key = NULL', 'application_removed = 0');
    }
    if (sets.length) await db.execute(`UPDATE reminders SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, [...params, id, userId]);
    return { id };
  });

// Completing, dismissing or reopening twice is harmless: an unchanged status keeps its original timestamp.
export const setStatus = async (userId: string, id: string, status: ReminderStatus): Promise<'not_found' | 'ok'> => {
  const [result]: any = await pool.execute(
    `UPDATE reminders
        SET completed_at = IF(? = 'completed', COALESCE(completed_at, CURRENT_TIMESTAMP(3)), NULL),
            dismissed_at = IF(? = 'dismissed', COALESCE(dismissed_at, CURRENT_TIMESTAMP(3)), NULL),
            status = ?
      WHERE id = ? AND user_id = ?`,
    [status, status, status, id, userId]
  );
  return result.affectedRows > 0 ? 'ok' : 'not_found';
};

export const deleteReminder = async (userId: string, id: string) => {
  const [result]: any = await pool.execute('DELETE FROM reminders WHERE id = ? AND user_id = ?', [id, userId]);
  return result.affectedRows > 0;
};

export interface ListQuery {
  view: View;
  from: string | null; // ISO, inclusive
  to: string | null; // ISO, inclusive
  applicationId: string | null;
  type: ReminderType | null;
  page: number;
  limit: number;
}

const VIEW_FILTER: Record<View, string> = {
  upcoming: "r.status = 'pending' AND r.due_at >= ?",
  overdue: "r.status = 'pending' AND r.due_at < ?",
  pending: "r.status = 'pending'",
  completed: "r.status = 'completed'",
  dismissed: "r.status = 'dismissed'",
  all: '1 = 1',
};
// Soonest first for what is still to do; most recent first for what is done.
const VIEW_ORDER: Record<View, string> = {
  upcoming: 'r.due_at ASC',
  overdue: 'r.due_at ASC',
  pending: 'r.due_at ASC',
  completed: 'r.completed_at DESC',
  dismissed: 'r.dismissed_at DESC',
  all: 'r.due_at DESC',
};

export const listReminders = async (userId: string, q: ListQuery, now = Date.now()) => {
  const nowSql = toSqlUtc(new Date(now).toISOString());
  const where = ['r.user_id = ?', VIEW_FILTER[q.view]];
  const params: string[] = [userId];
  if (q.view === 'upcoming' || q.view === 'overdue') params.push(nowSql);
  if (q.from) {
    where.push('r.due_at >= ?');
    params.push(toSqlUtc(q.from));
  }
  if (q.to) {
    where.push('r.due_at <= ?');
    params.push(toSqlUtc(q.to));
  }
  if (q.applicationId) {
    where.push('r.application_id = ?');
    params.push(q.applicationId);
  }
  if (q.type) {
    where.push('r.reminder_type = ?');
    params.push(q.type);
  }
  const [countRows]: any = await pool.execute(`SELECT COUNT(*) as total FROM reminders r WHERE ${where.join(' AND ')}`, params);
  // query() rather than execute(): MySQL prepared statements reject LIMIT/OFFSET placeholders.
  const [rows]: any = await pool.query(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY ${VIEW_ORDER[q.view]}, r.created_at ASC, r.id ASC LIMIT ? OFFSET ?`, [
    ...params,
    q.limit,
    (q.page - 1) * q.limit,
  ]);
  const total = Number(countRows[0].total);
  return {
    items: rows.map((r: any) => toReminder(r, now)) as Reminder[],
    pagination: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
  };
};

export const SUMMARY_LIST_SIZE = 5;
export const UPCOMING_WINDOW_DAYS = 7;

// What the in-app reminder panels show: counts plus the first few overdue and upcoming reminders.
export const getSummary = async (userId: string, now = Date.now()) => {
  const nowSql = toSqlUtc(new Date(now).toISOString());
  const daySql = toSqlUtc(new Date(now + 86_400_000).toISOString());
  const weekSql = toSqlUtc(new Date(now + UPCOMING_WINDOW_DAYS * 86_400_000).toISOString());
  const [countRows]: any = await pool.execute(
    `SELECT COUNT(CASE WHEN status = 'pending' AND due_at < ? THEN 1 END) as overdue,
            COUNT(CASE WHEN status = 'pending' AND due_at >= ? AND due_at < ? THEN 1 END) as dueWithin24Hours,
            COUNT(CASE WHEN status = 'pending' AND due_at >= ? AND due_at < ? THEN 1 END) as upcomingThisWeek,
            COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
            COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
            COUNT(CASE WHEN status = 'dismissed' THEN 1 END) as dismissed
       FROM reminders WHERE user_id = ?`,
    [nowSql, nowSql, daySql, nowSql, weekSql, userId]
  );
  const [overdueRows]: any = await pool.query(`${SELECT} WHERE r.user_id = ? AND r.status = 'pending' AND r.due_at < ? ORDER BY r.due_at ASC, r.created_at ASC, r.id ASC LIMIT ?`, [
    userId,
    nowSql,
    SUMMARY_LIST_SIZE,
  ]);
  const [upcomingRows]: any = await pool.query(
    `${SELECT} WHERE r.user_id = ? AND r.status = 'pending' AND r.due_at >= ? AND r.due_at < ? ORDER BY r.due_at ASC, r.created_at ASC, r.id ASC LIMIT ?`,
    [userId, nowSql, weekSql, SUMMARY_LIST_SIZE]
  );
  // Outdated reminders are found by comparing with the application, so they are read rather than counted in SQL.
  const [pendingRows]: any = await pool.execute(`${SELECT} WHERE r.user_id = ? AND r.status = 'pending'`, [userId]);
  const c = countRows[0];
  return {
    counts: {
      overdue: Number(c.overdue),
      dueWithin24Hours: Number(c.dueWithin24Hours),
      upcomingThisWeek: Number(c.upcomingThisWeek),
      pending: Number(c.pending),
      completed: Number(c.completed),
      dismissed: Number(c.dismissed),
      mayBeOutdated: pendingRows.filter((r: any) => outdatedReason(r) !== null).length,
    },
    overdue: overdueRows.map((r: any) => toReminder(r, now)) as Reminder[],
    upcoming: upcomingRows.map((r: any) => toReminder(r, now)) as Reminder[],
  };
};

// ---- Suggestions from an application's own interview and follow-up dates ----

export type SuggestionKind = 'interview' | 'follow_up';
const SOURCE: Record<SuggestionKind, 'application_interview' | 'application_follow_up'> = {
  interview: 'application_interview',
  follow_up: 'application_follow_up',
};

export interface Suggestion {
  applicationId: string;
  jobTitle: string;
  companyName: string;
  kind: SuggestionKind;
  // The interview time (ISO, UTC) or the follow-up date (YYYY-MM-DD), exactly as recorded on the application.
  eventAt: string;
  suggestedTitle: string;
}

const suggestedTitle = (kind: SuggestionKind, jobTitle: string, companyName: string) => {
  const title = `${kind === 'interview' ? 'Interview' : 'Follow up'}: ${jobTitle} at ${companyName}`;
  return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1)}…` : title;
};

// Interviews still ahead and follow-ups from `asOf` on, for open applications,
// that do not already have a reminder for that exact date (in any status, so a
// dismissed suggestion does not come back).
export const getSuggestions = async (userId: string, asOf: string, applicationId: string | null = null, now = Date.now()) => {
  const closed = CLOSED_STATUSES.map(() => '?').join(', ');
  const [rows]: any = await pool.execute(
    `SELECT a.id, a.job_title as jobTitle, a.company_name as companyName,
            DATE_FORMAT(a.interview_at, '%Y-%m-%dT%H:%i:%sZ') as interviewAt, DATE_FORMAT(a.follow_up_on, '%Y-%m-%d') as followUpOn,
            (SELECT GROUP_CONCAT(r.source_key SEPARATOR '|') FROM reminders r WHERE r.application_id = a.id AND r.user_id = a.user_id AND r.source_key IS NOT NULL) as existingKeys
       FROM job_applications a
      WHERE a.user_id = ? AND a.status NOT IN (${closed}) ${applicationId ? 'AND a.id = ?' : ''}
        AND (a.interview_at > ? OR a.follow_up_on >= ?)
      ORDER BY a.updated_at DESC, a.id`,
    [userId, ...CLOSED_STATUSES, ...(applicationId ? [applicationId] : []), toSqlUtc(new Date(now).toISOString()), asOf]
  );
  const out: Suggestion[] = [];
  for (const r of rows) {
    const existing = new Set(String(r.existingKeys ?? '').split('|'));
    if (r.interviewAt && Date.parse(r.interviewAt) > now && !existing.has(`interview:${r.interviewAt}`)) {
      out.push({ applicationId: r.id, jobTitle: r.jobTitle, companyName: r.companyName, kind: 'interview', eventAt: r.interviewAt, suggestedTitle: suggestedTitle('interview', r.jobTitle, r.companyName) });
    }
    if (r.followUpOn && r.followUpOn >= asOf && !existing.has(`follow_up:${r.followUpOn}`)) {
      out.push({ applicationId: r.id, jobTitle: r.jobTitle, companyName: r.companyName, kind: 'follow_up', eventAt: r.followUpOn, suggestedTitle: suggestedTitle('follow_up', r.jobTitle, r.companyName) });
    }
  }
  return out.sort((a, b) => (a.kind === 'interview' ? a.eventAt : `${a.eventAt}T00:00:00Z`).localeCompare(b.kind === 'interview' ? b.eventAt : `${b.eventAt}T00:00:00Z`));
};

export interface AcceptInput {
  applicationId: string;
  kind: SuggestionKind;
  timeZone: string;
  leadMinutes: number; // interview: how long before the interview
  time: string; // follow-up: "HH:mm" on the follow-up date
  asOf: string;
}

export type AcceptResult =
  | { id: string; created: boolean }
  | 'application_not_found'
  | 'no_date' // the application has no such date (any more), or it has passed
  | 'application_closed'
  | 'in_past'
  | 'nonexistent_time';

// Saves a confirmed suggestion. The date is read from the application, never
// taken from the request, and saving the same suggestion again returns the
// reminder that already exists instead of creating a second one.
export const acceptSuggestion = (userId: string, input: AcceptInput, now = Date.now()): Promise<AcceptResult> =>
  transaction(async (db) => {
    const [rows]: any = await db.execute(
      `SELECT job_title as jobTitle, company_name as companyName, status,
              DATE_FORMAT(interview_at, '%Y-%m-%dT%H:%i:%sZ') as interviewAt, DATE_FORMAT(follow_up_on, '%Y-%m-%d') as followUpOn
         FROM job_applications WHERE id = ? AND user_id = ? FOR UPDATE`,
      [input.applicationId, userId]
    );
    const app = rows[0];
    if (!app) return 'application_not_found';
    if (CLOSED_STATUSES.includes(app.status)) return 'application_closed';

    let sourceKey: string;
    let dueIso: string;
    if (input.kind === 'interview') {
      if (!app.interviewAt || Date.parse(app.interviewAt) <= now) return 'no_date';
      sourceKey = `interview:${app.interviewAt}`;
      dueIso = new Date(Date.parse(app.interviewAt) - input.leadMinutes * 60_000).toISOString();
      if (Date.parse(dueIso) <= now) return 'in_past';
    } else {
      if (!app.followUpOn || app.followUpOn < input.asOf) return 'no_date';
      sourceKey = `follow_up:${app.followUpOn}`;
      const due = localToUtc(`${app.followUpOn}T${input.time}`, input.timeZone);
      if (!due.ok) return 'nonexistent_time';
      dueIso = due.utc;
    }

    const [existing]: any = await db.execute('SELECT id FROM reminders WHERE application_id = ? AND source_key = ? AND user_id = ?', [input.applicationId, sourceKey, userId]);
    if (existing[0]) return { id: existing[0].id as string, created: false };
    const id = uuidv4();
    try {
      await db.execute(
        `INSERT INTO reminders (id, user_id, application_id, reminder_type, title, due_at, time_zone, source, source_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, input.applicationId, input.kind, suggestedTitle(input.kind, app.jobTitle, app.companyName), toSqlUtc(dueIso), input.timeZone, SOURCE[input.kind], sourceKey]
      );
    } catch (error: any) {
      // The unique key on (application_id, source_key) is the final guard against a double save.
      if (error?.code !== 'ER_DUP_ENTRY') throw error;
      const [again]: any = await db.execute('SELECT id FROM reminders WHERE application_id = ? AND source_key = ? AND user_id = ?', [input.applicationId, sourceKey, userId]);
      return { id: again[0].id as string, created: false };
    }
    return { id, created: true };
  });

// Pending reminders grouped by their local calendar day, for the "busy day" recommendation.
export const pendingByLocalDay = async (userId: string, now = Date.now(), days = 14) => {
  const [rows]: any = await pool.execute(
    `SELECT DATE_FORMAT(due_at, '%Y-%m-%dT%H:%i:%sZ') as dueAt, time_zone as timeZone FROM reminders
      WHERE user_id = ? AND status = 'pending' AND due_at >= ? AND due_at < ?`,
    [userId, toSqlUtc(new Date(now).toISOString()), toSqlUtc(new Date(now + days * 86_400_000).toISOString())]
  );
  const counts = new Map<string, number>();
  for (const r of rows) {
    const day = localDate(Date.parse(r.dueAt), r.timeZone);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return counts;
};
