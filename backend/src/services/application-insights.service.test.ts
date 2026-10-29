import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import * as apps from './job-application.service';
import * as reminders from './reminder.service';
import { getInsights, monthRange, MIN_FUNNEL_SAMPLE, type Recommendation } from './application-insights.service';
import type { ApplicationFields, ApplicationStatus } from './job-application.service';
import { toLocal } from '../utils/time-zone';

test('month range: ends with the month of the date, crosses years', () => {
  assert.deepEqual(monthRange('2026-02-15', 4), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.deepEqual(monthRange('2026-10-31', 1), ['2026-10']);
});

// Opt-in SQL tests (a database with migrations 001-014 applied):
//   DASHBOARD_DB_TESTS=1 DB_NAME=<test db> DB_PASSWORD=<pw> npm test
const dbTests = process.env.DASHBOARD_DB_TESTS === '1';
const skip = !dbTests && 'set DASHBOARD_DB_TESTS=1';
const createdUsers: string[] = [];
after(async () => {
  if (!dbTests) return;
  for (const id of createdUsers) await pool.execute('DELETE FROM users WHERE id = ?', [id]);
  await pool.end();
});

const user = async () => {
  const id = uuidv4();
  createdUsers.push(id);
  await pool.execute('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)', [id, 'T', `${id}@a.test`, 'x']);
  return id;
};
const EMPTY = Object.fromEntries(
  ['postingUrl', 'appliedOn', 'location', 'employmentType', 'compensationNotes', 'contactName', 'contactEmail', 'contactPhone', 'notes', 'interviewAt', 'interviewType', 'interviewStage', 'interviewerName', 'interviewNotes', 'followUpOn', 'followUpNotes', 'jobDescriptionId', 'resumeId', 'coverLetterId'].map((k) => [k, null])
) as unknown as ApplicationFields;
const application = async (userId: string, o: Partial<ApplicationFields> = {}) => {
  const r = await apps.createApplication(userId, { ...EMPTY, jobTitle: 'Developer', companyName: 'Acme', status: 'wishlist', ...o });
  assert.ok(typeof r === 'object' && 'id' in r);
  return r.id;
};
// Moves an application through statuses, as the user would, so the history records each step.
const through = async (userId: string, statuses: ApplicationStatus[], o: Partial<ApplicationFields> = {}) => {
  const id = await application(userId, { status: statuses[0], ...o });
  for (const status of statuses.slice(1)) await apps.updateApplication(userId, id, { status });
  return id;
};
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const today = () => new Date().toISOString().slice(0, 10);
const isoMinute = (ms: number) => new Date(Math.floor((Date.now() + ms) / 60_000) * 60_000).toISOString().replace('.000Z', 'Z');
const kinds = (recs: Recommendation[]) => recs.map((r) => r.kind);

test('SQL insights: an empty account has zeros, no rates and no conclusions', { skip }, async () => {
  const u = await user();
  const i = await getInsights(u, { asOf: today(), months: 6 });
  assert.deepEqual(
    [i.applications.total, i.applications.submitted, i.applications.inInterviewStages, i.applications.offers, i.applications.rejections, i.applications.upcomingInterviews, i.applications.followUpsDue, i.applications.followUpsScheduled],
    [0, 0, 0, 0, 0, 0, 0, 0]
  );
  assert.ok(Object.values(i.applications.byStatus).every((n) => n === 0));
  assert.deepEqual(i.reminders, { pending: 0, overdue: 0, upcomingThisWeek: 0, completed: 0, dismissed: 0, completionRate: null });
  assert.deepEqual([i.funnel.enoughData, i.funnel.stages.map((s) => [s.count, s.rate])], [false, [[0, null], [0, null], [0, null]]]);
  assert.equal(i.monthly.length, 6);
  assert.ok(i.monthly.every((m) => m.applied === 0 && m.added === 0));
  assert.deepEqual(i.upcomingInterviews, []);
  assert.deepEqual(kinds(i.recommendations), ['no_applications']);
});

test('SQL insights: counts, status distribution and funnel follow the documented rules', { skip }, async () => {
  const u = await user();
  const other = await user();
  await through(other, ['applied', 'interview', 'offer']); // never counted for u
  await application(u, { status: 'wishlist' });
  await application(u, { status: 'preparing' });
  await through(u, ['applied'], { appliedOn: today() });
  await through(u, ['applied', 'assessment']);
  await through(u, ['applied', 'interview'], { interviewAt: isoMinute(5 * DAY) });
  await through(u, ['applied', 'interview', 'rejected']); // reached interview before rejection
  await through(u, ['applied', 'interview', 'offer']);
  await through(u, ['applied', 'rejected']);
  await through(u, ['preparing', 'withdrawn']); // never sent: not submitted
  await through(u, ['applied', 'withdrawn'], { appliedOn: '2026-01-05' }); // sent, then withdrawn

  const i = await getInsights(u, { asOf: today(), months: 3 });
  const a = i.applications;
  assert.deepEqual([a.total, a.submitted, a.inInterviewStages, a.offers, a.rejections, a.upcomingInterviews], [10, 7, 2, 1, 2, 1]);
  assert.deepEqual(a.byStatus, { wishlist: 1, preparing: 1, applied: 1, assessment: 1, interview: 1, offer: 1, rejected: 2, withdrawn: 2 });
  assert.equal(Object.values(a.byStatus).reduce((s, n) => s + n, 0), a.total, 'each application counted once');

  // 7 submitted; reached interview: interview, interview>rejected, offer = 3; reached offer = 1.
  assert.ok(7 >= MIN_FUNNEL_SAMPLE);
  assert.deepEqual(i.funnel.stages.map((s) => [s.key, s.count, s.rate]), [['submitted', 7, 100], ['interview', 3, 42.9], ['offer', 1, 14.3]]);

  // Monthly: only applications with an application date in range; "added" counts this month's 10 additions.
  const thisMonth = today().slice(0, 7);
  assert.deepEqual(i.monthly.map((m) => m.month), monthRange(today(), 3));
  assert.deepEqual(i.monthly.find((m) => m.month === thisMonth), { month: thisMonth, applied: 1, added: 10 });
  assert.equal(i.monthly.reduce((s, m) => s + m.applied, 0), 1, 'January is outside a 3-month window');
  const year = await getInsights(u, { asOf: today(), months: 24 });
  assert.equal(year.monthly.reduce((s, m) => s + m.applied, 0), today() >= '2026-01-05' ? 2 : 1);
  assert.deepEqual(i.upcomingInterviews.map((x) => x.status), ['interview']);
});

test('SQL insights: rates are withheld below the minimum sample', { skip }, async () => {
  const u = await user();
  for (let n = 0; n < MIN_FUNNEL_SAMPLE - 1; n++) await through(u, ['applied']);
  let i = await getInsights(u, { asOf: today(), months: 6 });
  assert.deepEqual([i.funnel.enoughData, i.funnel.stages.map((s) => s.rate)], [false, [null, null, null]]);
  assert.equal(i.funnel.stages[0].count, MIN_FUNNEL_SAMPLE - 1, 'counts are still shown');
  await through(u, ['applied']);
  i = await getInsights(u, { asOf: today(), months: 6 });
  assert.deepEqual([i.funnel.enoughData, i.funnel.stages.map((s) => s.rate)], [true, [100, 0, 0]]);
});

test('SQL insights: reminder counts and completion rate', { skip }, async () => {
  const u = await user();
  const mk = async (title: string) => {
    const r = await reminders.createReminder(u, { type: 'custom', title, notes: null, dueLocal: toLocal(Date.now() + 2 * DAY, 'UTC'), timeZone: 'UTC', applicationId: null });
    return (r as { id: string }).id;
  };
  const ids = [await mk('a'), await mk('b'), await mk('c'), await mk('d')];
  await reminders.setStatus(u, ids[0], 'completed');
  await reminders.setStatus(u, ids[1], 'dismissed');
  await pool.execute('UPDATE reminders SET due_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY) WHERE id = ?', [ids[2]]);
  const i = await getInsights(u, { asOf: today(), months: 6 });
  // completed 1 / (completed 1 + pending 2); the dismissed one is left out.
  assert.deepEqual(i.reminders, { pending: 2, overdue: 1, upcomingThisWeek: 1, completed: 1, dismissed: 1, completionRate: 33.3 });
});

test('SQL insights: recommendations come only from the user’s actual data', { skip }, async () => {
  const u = await user();
  // A tidy account: one active application with a next step. Nothing to recommend.
  const tidy = await through(u, ['applied'], { followUpOn: new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10) });
  assert.deepEqual(kinds((await getInsights(u, { asOf: today(), months: 6 })).recommendations), []);

  // Interview within 72 hours (and one further out that is not mentioned).
  const soon = await through(u, ['applied', 'interview'], { jobTitle: 'Soon', interviewAt: isoMinute(30 * HOUR) });
  await through(u, ['applied', 'interview'], { interviewAt: isoMinute(10 * DAY) });
  // Two follow-ups due; an active application with no next step.
  await through(u, ['applied'], { followUpOn: '2026-01-02' });
  await through(u, ['applied'], { followUpOn: '2026-01-03' });
  const idle = await through(u, ['applied', 'assessment'], { jobTitle: 'Idle' });
  // Three reminders on the same local day, one overdue reminder.
  const day = toLocal(Date.now() + 4 * DAY, 'Asia/Kolkata').slice(0, 10);
  for (const t of ['09:00', '12:00', '18:00']) await reminders.createReminder(u, { type: 'custom', title: t, notes: null, dueLocal: `${day}T${t}`, timeZone: 'Asia/Kolkata', applicationId: null });
  const late = (await reminders.createReminder(u, { type: 'custom', title: 'late', notes: null, dueLocal: toLocal(Date.now() + DAY, 'UTC'), timeZone: 'UTC', applicationId: tidy })) as { id: string };
  await pool.execute('UPDATE reminders SET due_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY) WHERE id = ?', [late.id]);

  let recs = (await getInsights(u, { asOf: today(), months: 6 })).recommendations;
  assert.deepEqual(kinds(recs), ['overdue_reminders', 'follow_ups_due', 'interview_soon', 'busy_day', 'no_next_step']);
  const get = <K extends Recommendation['kind']>(k: K) => recs.find((r) => r.kind === k) as Extract<Recommendation, { kind: K }>;
  assert.equal(get('overdue_reminders').count, 1);
  assert.equal(get('follow_ups_due').count, 2);
  assert.deepEqual([get('interview_soon').application.id, get('interview_soon').application.jobTitle], [soon, 'Soon']);
  assert.deepEqual([get('busy_day').date, get('busy_day').count], [day, 3]);
  assert.deepEqual([get('no_next_step').count, get('no_next_step').applications.map((a) => a.id)], [1, [idle]]);

  // Adding a reminder to the idle application gives it a next step.
  await reminders.createReminder(u, { type: 'assessment', title: 'Submit test', notes: null, dueLocal: toLocal(Date.now() + 2 * DAY, 'UTC'), timeZone: 'UTC', applicationId: idle });
  // Closing the application with an overdue reminder flags that reminder instead of deleting it.
  await apps.updateApplication(u, tidy, { status: 'withdrawn' });
  // No application added for 20 days.
  await pool.execute('UPDATE job_applications SET created_at = DATE_SUB(NOW(3), INTERVAL 20 DAY) WHERE user_id = ?', [u]);
  recs = (await getInsights(u, { asOf: today(), months: 6 })).recommendations;
  assert.ok(!kinds(recs).includes('no_next_step'));
  assert.equal(get('outdated_reminders').count, 1);
  assert.equal(get('inactive').days, 20);
});
