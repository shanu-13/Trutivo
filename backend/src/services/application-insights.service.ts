import pool from '../config/database';
import { CLOSED_STATUSES, SUBMITTED_STATUSES, getMetrics, type ApplicationStatus } from './job-application.service';
import { getSummary, pendingByLocalDay } from './reminder.service';

// Application insights (Step 14): counts from the user's own saved applications
// and reminders, calculated directly in SQL. Nothing is estimated or predicted.

// Conversion rates are only shown once at least this many applications were submitted.
export const MIN_FUNNEL_SAMPLE = 5;
export const DEFAULT_MONTHS = 6;
export const MAX_MONTHS = 24;
// Recommendation thresholds.
export const INTERVIEW_SOON_HOURS = 72;
export const INACTIVE_DAYS = 14;
export const BUSY_DAY_REMINDERS = 3;
export const BUSY_DAY_WINDOW_DAYS = 14;
const LIST_SIZE = 5;

// Applications that have been sent and are still waiting on a next step.
const ACTIVE_STATUSES = ['applied', 'assessment', 'interview'] as const;

const toSqlUtc = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const rate = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

// "2026-05", ... "2026-10": the `count` months ending with the month of `asOf`.
export const monthRange = (asOf: string, count: number) => {
  const [y, m] = asOf.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (count - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
};

export type Recommendation =
  | { kind: 'no_applications'; tone: 'info' }
  | { kind: 'overdue_reminders'; tone: 'attention'; count: number }
  | { kind: 'follow_ups_due'; tone: 'attention'; count: number }
  | { kind: 'interview_soon'; tone: 'info'; application: { id: string; jobTitle: string; companyName: string }; interviewAt: string }
  | { kind: 'busy_day'; tone: 'info'; date: string; count: number }
  | { kind: 'no_next_step'; tone: 'info'; count: number; applications: { id: string; jobTitle: string; companyName: string }[] }
  | { kind: 'outdated_reminders'; tone: 'info'; count: number }
  | { kind: 'inactive'; tone: 'info'; days: number };

export const getInsights = async (userId: string, opts: { asOf: string; months: number; now?: number }) => {
  const now = opts.now ?? Date.now();
  const nowSql = toSqlUtc(now);
  const metrics = await getMetrics(userId, opts.asOf);
  const reminderSummary = await getSummary(userId, now);

  const closed = CLOSED_STATUSES.map(() => '?').join(', ');
  const [followUpRows]: any = await pool.execute(
    `SELECT COUNT(*) as scheduled FROM job_applications WHERE user_id = ? AND follow_up_on > ? AND status NOT IN (${closed})`,
    [userId, opts.asOf, ...CLOSED_STATUSES]
  );

  const [interviewRows]: any = await pool.execute(
    `SELECT id, job_title as jobTitle, company_name as companyName, status, interview_type as interviewType,
            DATE_FORMAT(interview_at, '%Y-%m-%dT%H:%i:%sZ') as interviewAt
       FROM job_applications WHERE user_id = ? AND interview_at >= ? ORDER BY interview_at ASC, id LIMIT ${LIST_SIZE}`,
    [userId, nowSql]
  );

  // Monthly activity: applications by the application date the user entered, and
  // applications added to the tracker (by when they were added, in UTC).
  const months = monthRange(opts.asOf, opts.months);
  const first = `${months[0]}-01`;
  const [submittedByMonth]: any = await pool.execute(
    `SELECT DATE_FORMAT(applied_on, '%Y-%m') as month, COUNT(*) as n FROM job_applications
      WHERE user_id = ? AND applied_on >= ? AND applied_on <= ? GROUP BY month`,
    [userId, first, opts.asOf]
  );
  // Epoch seconds, so the month is UTC whatever the database session's time zone is.
  const [addedRows]: any = await pool.execute(
    'SELECT UNIX_TIMESTAMP(created_at) as ts FROM job_applications WHERE user_id = ? AND created_at >= FROM_UNIXTIME(?)',
    [userId, Date.parse(`${first}T00:00:00Z`) / 1000]
  );
  const submittedMap = new Map<string, number>(submittedByMonth.map((r: any) => [r.month, Number(r.n)]));
  const addedMap = new Map<string, number>();
  for (const { ts } of addedRows) {
    const month = new Date(Number(ts) * 1000).toISOString().slice(0, 7);
    addedMap.set(month, (addedMap.get(month) ?? 0) + 1);
  }
  const monthly = months.map((month) => ({ month, applied: submittedMap.get(month) ?? 0, added: addedMap.get(month) ?? 0 }));

  // Funnel over submitted applications. A stage counts as reached if the
  // application is in it now or its history shows it was moved there.
  const submitted = SUBMITTED_STATUSES.map(() => '?').join(', ');
  const reached = (statuses: string[]) =>
    `(a.status IN (${statuses.map(() => '?').join(', ')}) OR EXISTS (SELECT 1 FROM job_application_events e
        WHERE e.application_id = a.id AND e.user_id = a.user_id AND e.to_status IN (${statuses.map(() => '?').join(', ')})))`;
  const [funnelRows]: any = await pool.execute(
    `SELECT COUNT(*) as submitted,
            COUNT(CASE WHEN ${reached(['interview', 'offer'])} THEN 1 END) as interview,
            COUNT(CASE WHEN ${reached(['offer'])} THEN 1 END) as offer
       FROM job_applications a
      WHERE a.user_id = ? AND (a.status IN (${submitted}) OR (a.status = 'withdrawn' AND a.applied_on IS NOT NULL))`,
    ['interview', 'offer', 'interview', 'offer', 'offer', 'offer', userId, ...SUBMITTED_STATUSES]
  );
  const f = funnelRows[0];
  const funnelBase = Number(f.submitted);
  const enough = funnelBase >= MIN_FUNNEL_SAMPLE;
  const funnel = {
    minimumSample: MIN_FUNNEL_SAMPLE,
    enoughData: enough,
    stages: [
      { key: 'submitted', count: funnelBase, rate: enough ? rate(funnelBase, funnelBase) : null },
      { key: 'interview', count: Number(f.interview), rate: enough ? rate(Number(f.interview), funnelBase) : null },
      { key: 'offer', count: Number(f.offer), rate: enough ? rate(Number(f.offer), funnelBase) : null },
    ],
  };

  // Active applications with nothing recorded to do next: no future interview, no follow-up date
  // (a past-due follow-up is still a next step, reported as due) and no pending reminder.
  const active = ACTIVE_STATUSES.map(() => '?').join(', ');
  const [noNextRows]: any = await pool.execute(
    `SELECT a.id, a.job_title as jobTitle, a.company_name as companyName FROM job_applications a
      WHERE a.user_id = ? AND a.status IN (${active})
        AND (a.interview_at IS NULL OR a.interview_at < ?)
        AND a.follow_up_on IS NULL
        AND NOT EXISTS (SELECT 1 FROM reminders r WHERE r.application_id = a.id AND r.user_id = a.user_id AND r.status = 'pending')
      ORDER BY a.updated_at ASC, a.id`,
    [userId, ...ACTIVE_STATUSES, nowSql]
  );

  const [lastRows]: any = await pool.execute('SELECT MAX(created_at) as lastAdded FROM job_applications WHERE user_id = ?', [userId]);
  const lastAdded: Date | null = lastRows[0].lastAdded ? new Date(lastRows[0].lastAdded) : null;
  const daysSinceLastAdded = lastAdded ? Math.floor((now - lastAdded.getTime()) / 86_400_000) : null;

  const r = reminderSummary.counts;
  const reminders = {
    pending: r.pending,
    overdue: r.overdue,
    upcomingThisWeek: r.upcomingThisWeek,
    completed: r.completed,
    dismissed: r.dismissed,
    // Completed out of completed + still pending; dismissed reminders are left out.
    completionRate: rate(r.completed, r.completed + r.pending),
  };

  const recommendations: Recommendation[] = [];
  if (metrics.total === 0) recommendations.push({ kind: 'no_applications', tone: 'info' });
  if (r.overdue > 0) recommendations.push({ kind: 'overdue_reminders', tone: 'attention', count: r.overdue });
  if (metrics.followUpsDue > 0) recommendations.push({ kind: 'follow_ups_due', tone: 'attention', count: metrics.followUpsDue });
  for (const i of interviewRows) {
    if (Date.parse(i.interviewAt) - now > INTERVIEW_SOON_HOURS * 3_600_000) break;
    if (CLOSED_STATUSES.includes(i.status)) continue;
    recommendations.push({ kind: 'interview_soon', tone: 'info', application: { id: i.id, jobTitle: i.jobTitle, companyName: i.companyName }, interviewAt: i.interviewAt });
  }
  const busy = [...(await pendingByLocalDay(userId, now, BUSY_DAY_WINDOW_DAYS)).entries()].filter(([, n]) => n >= BUSY_DAY_REMINDERS).sort(([a], [b]) => a.localeCompare(b));
  for (const [date, count] of busy) recommendations.push({ kind: 'busy_day', tone: 'info', date, count });
  if (noNextRows.length > 0) {
    recommendations.push({ kind: 'no_next_step', tone: 'info', count: noNextRows.length, applications: noNextRows.slice(0, LIST_SIZE) });
  }
  if (r.mayBeOutdated > 0) recommendations.push({ kind: 'outdated_reminders', tone: 'info', count: r.mayBeOutdated });
  if (daysSinceLastAdded !== null && daysSinceLastAdded >= INACTIVE_DAYS) recommendations.push({ kind: 'inactive', tone: 'info', days: daysSinceLastAdded });

  return {
    asOf: opts.asOf,
    applications: {
      total: metrics.total,
      submitted: metrics.submitted,
      inInterviewStages: metrics.byStatus.assessment + metrics.byStatus.interview,
      offers: metrics.offers,
      rejections: metrics.rejections,
      upcomingInterviews: metrics.upcomingInterviews,
      followUpsDue: metrics.followUpsDue,
      followUpsScheduled: Number(followUpRows[0].scheduled),
      byStatus: metrics.byStatus,
    },
    upcomingInterviews: interviewRows.map((i: any) => ({ id: i.id, jobTitle: i.jobTitle, companyName: i.companyName, status: i.status, interviewType: i.interviewType, interviewAt: i.interviewAt })) as {
      id: string;
      jobTitle: string;
      companyName: string;
      status: ApplicationStatus;
      interviewType: string | null;
      interviewAt: string;
    }[],
    reminders,
    monthly,
    funnel,
    recommendations,
  };
};

export const DEFINITIONS = {
  total: 'All applications you track, in any status.',
  submitted: 'Applications with status Applied, Assessment, Interview, Offer or Rejected, plus withdrawn ones that have an application date.',
  inInterviewStages: 'Applications whose current status is Assessment or Interview.',
  offers: 'Applications whose current status is Offer.',
  rejections: 'Applications whose current status is Rejected.',
  upcomingInterviews: 'Applications with an interview date and time still ahead.',
  followUpsDue: 'Open applications (not Offer, Rejected or Withdrawn) whose follow-up date is today or earlier.',
  followUpsScheduled: 'Open applications whose follow-up date is after today.',
  byStatus: 'Every tracked application counted once, under its current status.',
  remindersPending: 'Reminders not yet completed or dismissed, including overdue ones.',
  remindersOverdue: 'Pending reminders whose due time has passed.',
  remindersCompleted: 'Reminders you marked as done.',
  completionRate: 'Completed reminders divided by completed plus pending reminders. Dismissed reminders are not counted. Not shown when there are none.',
  monthlyApplied: 'Applications whose application date falls in the month. Applications without an application date are not included.',
  monthlyAdded: 'Applications added to the tracker in the month (by the date they were added, in UTC).',
  funnel: `Of the submitted applications, how many reached the Interview stage and how many reached Offer, now or at any earlier point in their history. Percentages are shown only once at least ${MIN_FUNNEL_SAMPLE} applications have been submitted.`,
} as const;
