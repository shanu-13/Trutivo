import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import * as apps from './job-application.service';
import * as reminders from './reminder.service';
import type { ApplicationFields } from './job-application.service';
import type { ListQuery, ReminderInput } from './reminder.service';
import { toLocal } from '../utils/time-zone';

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
  const r = await apps.createApplication(userId, { ...EMPTY, jobTitle: 'Developer', companyName: 'Acme', status: 'applied', ...o });
  assert.ok(typeof r === 'object' && 'id' in r);
  return r.id;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Local "YYYY-MM-DDTHH:mm" in UTC for a moment `ms` from now (whole minutes).
const inUtc = (ms: number) => toLocal(Math.floor((Date.now() + ms) / 60_000) * 60_000, 'UTC');
const input = (o: Partial<ReminderInput> = {}): ReminderInput => ({ type: 'custom', title: 'Reminder', notes: null, dueLocal: inUtc(DAY), timeZone: 'UTC', applicationId: null, ...o });
const create = async (userId: string, o: Partial<ReminderInput> = {}) => {
  const r = await reminders.createReminder(userId, input(o));
  assert.ok(typeof r === 'object', String(r));
  return r.id;
};
const q = (o: Partial<ListQuery> = {}): ListQuery => ({ view: 'all', from: null, to: null, applicationId: null, type: null, page: 1, limit: 20, ...o });
const isoMinute = (ms: number) => new Date(Math.floor((Date.now() + ms) / 60_000) * 60_000).toISOString().replace('.000Z', 'Z');

test('SQL reminders: create, read, update, complete, dismiss, reopen, delete', { skip }, async () => {
  const u = await user();
  const appId = await application(u);
  const id = await create(u, { type: 'recruiter_contact', title: 'Call Priya', notes: 'private note', dueLocal: '2030-03-10T09:30', timeZone: 'Asia/Kolkata', applicationId: appId });
  let r = (await reminders.getReminder(u, id))!;
  assert.deepEqual([r.type, r.title, r.notes, r.status, r.overdue, r.dueAt, r.timeZone, r.dueLocal], ['recruiter_contact', 'Call Priya', 'private note', 'pending', false, '2030-03-10T04:00:00Z', 'Asia/Kolkata', '2030-03-10T09:30']);
  assert.deepEqual(r.application, { id: appId, jobTitle: 'Developer', companyName: 'Acme', status: 'applied' });
  assert.equal(r.mayBeOutdated, null);

  // Changing only the time zone keeps the local time and moves the UTC moment.
  await reminders.updateReminder(u, id, { timeZone: 'Europe/London' });
  r = (await reminders.getReminder(u, id))!;
  assert.deepEqual([r.dueLocal, r.timeZone, r.dueAt], ['2030-03-10T09:30', 'Europe/London', '2030-03-10T09:30:00Z']);
  await reminders.updateReminder(u, id, { title: 'Call Priya back', notes: null, dueLocal: '2030-07-10T09:30' });
  r = (await reminders.getReminder(u, id))!;
  assert.deepEqual([r.title, r.notes, r.dueAt, r.timeZone], ['Call Priya back', null, '2030-07-10T08:30:00Z', 'Europe/London'], 'summer time applied');

  // Standalone, then linked again.
  await reminders.updateReminder(u, id, { applicationId: null });
  assert.equal((await reminders.getReminder(u, id))!.application, null);
  await reminders.updateReminder(u, id, { applicationId: appId });

  assert.equal(await reminders.setStatus(u, id, 'completed'), 'ok');
  r = (await reminders.getReminder(u, id))!;
  assert.equal(r.status, 'completed');
  const completedAt = r.completedAt;
  assert.ok(completedAt);
  // Completing twice keeps the original time.
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(await reminders.setStatus(u, id, 'completed'), 'ok');
  assert.deepEqual((await reminders.getReminder(u, id))!.completedAt, completedAt);

  await reminders.setStatus(u, id, 'dismissed');
  r = (await reminders.getReminder(u, id))!;
  assert.deepEqual([r.status, r.completedAt, Boolean(r.dismissedAt)], ['dismissed', null, true]);
  await reminders.setStatus(u, id, 'pending');
  r = (await reminders.getReminder(u, id))!;
  assert.deepEqual([r.status, r.completedAt, r.dismissedAt], ['pending', null, null]);

  assert.equal(await reminders.deleteReminder(u, id), true);
  assert.equal(await reminders.getReminder(u, id), null);
  assert.equal(await reminders.deleteReminder(u, id), false);
});

test('SQL reminders: times that do not exist or have passed are refused', { skip }, async () => {
  const u = await user();
  assert.equal(await reminders.createReminder(u, input({ dueLocal: '2030-03-31T01:30', timeZone: 'Europe/London' })), 'nonexistent_time');
  assert.equal(await reminders.createReminder(u, input({ dueLocal: inUtc(-HOUR) })), 'in_past');
  // An overdue reminder can still be edited if its due time is left alone.
  const id = await create(u, { dueLocal: inUtc(2 * 60_000) });
  await pool.execute('UPDATE reminders SET due_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 DAY) WHERE id = ?', [id]);
  const overdue = (await reminders.getReminder(u, id))!;
  assert.equal(overdue.overdue, true);
  assert.deepEqual(await reminders.updateReminder(u, id, { title: 'Still to do', dueLocal: overdue.dueLocal, timeZone: 'UTC' }), { id });
  assert.equal(await reminders.updateReminder(u, id, { dueLocal: inUtc(-HOUR) }), 'in_past');
  assert.equal(await reminders.updateReminder(u, id, { dueLocal: '2030-03-31T01:30', timeZone: 'Europe/London' }), 'nonexistent_time');
  assert.deepEqual(await reminders.updateReminder(u, id, { dueLocal: inUtc(DAY) }), { id });
  assert.equal((await reminders.getReminder(u, id))!.overdue, false);
});

test('SQL reminders: re-saving a repeated daylight-saving hour keeps the stored moment', { skip }, async () => {
  const u = await user();
  const id = await create(u, { dueLocal: '2030-10-27T01:30', timeZone: 'Europe/London' });
  // Move it to the second 01:30 (after the clocks went back).
  await pool.execute("UPDATE reminders SET due_at = '2030-10-27 01:30:00' WHERE id = ?", [id]);
  assert.equal((await reminders.getReminder(u, id))!.dueLocal, '2030-10-27T01:30');
  await reminders.updateReminder(u, id, { title: 'Edited', dueLocal: '2030-10-27T01:30', timeZone: 'Europe/London' });
  assert.equal((await reminders.getReminder(u, id))!.dueAt, '2030-10-27T01:30:00Z');
});

test('SQL reminders: upcoming, overdue and done views; same-time reminders; summary', { skip }, async () => {
  const u = await user();
  const late = await create(u, { title: 'late', dueLocal: inUtc(2 * 60_000) });
  await pool.execute('UPDATE reminders SET due_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 3 HOUR) WHERE id = ?', [late]);
  const sameTime = inUtc(2 * DAY);
  const a = await create(u, { title: 'same A', dueLocal: sameTime });
  const b = await create(u, { title: 'same B', dueLocal: sameTime });
  const soon = await create(u, { title: 'soon', dueLocal: inUtc(2 * HOUR) });
  const far = await create(u, { title: 'far', dueLocal: inUtc(30 * DAY) });
  const done = await create(u, { title: 'done' });
  await reminders.setStatus(u, done, 'completed');
  const gone = await create(u, { title: 'gone' });
  await reminders.setStatus(u, gone, 'dismissed');

  const titles = async (o: Partial<ListQuery>) => (await reminders.listReminders(u, q(o))).items.map((r) => r.title);
  assert.deepEqual(await titles({ view: 'overdue' }), ['late']);
  assert.deepEqual(await titles({ view: 'upcoming' }), ['soon', 'same A', 'same B', 'far'], 'soonest first; same-time reminders both listed');
  assert.deepEqual(await titles({ view: 'completed' }), ['done']);
  assert.deepEqual(await titles({ view: 'dismissed' }), ['gone']);
  assert.equal((await titles({ view: 'pending' })).length, 5);
  assert.equal((await titles({ view: 'all' })).length, 7);
  // Date range filter (inclusive) and pagination.
  assert.deepEqual(await titles({ view: 'upcoming', from: new Date(Date.now() + DAY).toISOString(), to: new Date(Date.now() + 3 * DAY).toISOString() }), ['same A', 'same B']);
  const page2 = await reminders.listReminders(u, q({ view: 'upcoming', limit: 3, page: 2 }));
  assert.deepEqual([page2.items.map((r) => r.title), page2.pagination.total, page2.pagination.totalPages], [['far'], 4, 2]);

  const s = await reminders.getSummary(u);
  assert.deepEqual(s.counts, { overdue: 1, dueWithin24Hours: 1, upcomingThisWeek: 3, pending: 5, completed: 1, dismissed: 1, mayBeOutdated: 0 });
  assert.deepEqual(s.overdue.map((r) => r.id), [late]);
  assert.deepEqual(s.upcoming.map((r) => r.id), [soon, a, b]);
  assert.ok(!s.upcoming.some((r) => r.id === far), '30 days away is outside the 7-day window');
  // Reading the summary changes nothing (nothing is "sent" twice).
  assert.deepEqual((await reminders.getSummary(u)).counts, s.counts);

  // Overdue is worked out at read time: the same reminder becomes overdue later without being written.
  assert.equal((await reminders.getReminder(u, soon, Date.now() + 3 * HOUR))!.overdue, true);
});

test('SQL reminders: other users cannot read, change, complete or delete; links must be the user’s own', { skip }, async () => {
  const owner = await user();
  const other = await user();
  const ownerApp = await application(owner);
  const otherApp = await application(other);
  const id = await create(owner, { applicationId: ownerApp, notes: 'secret' });

  assert.equal(await reminders.getReminder(other, id), null);
  assert.equal(await reminders.updateReminder(other, id, { title: 'hijack' }), 'not_found');
  assert.equal(await reminders.setStatus(other, id, 'completed'), 'not_found');
  assert.equal(await reminders.setStatus(other, id, 'dismissed'), 'not_found');
  assert.equal(await reminders.deleteReminder(other, id), false);
  assert.equal((await reminders.listReminders(other, q())).items.length, 0);
  assert.equal((await reminders.getSummary(other)).counts.pending, 0);
  const r = (await reminders.getReminder(owner, id))!;
  assert.deepEqual([r.title, r.status], ['Reminder', 'pending']);

  assert.equal(await reminders.createReminder(owner, input({ applicationId: otherApp })), 'application_not_found');
  assert.equal(await reminders.createReminder(owner, input({ applicationId: uuidv4() })), 'application_not_found');
  assert.equal(await reminders.updateReminder(owner, id, { applicationId: otherApp }), 'application_not_found');
  // Filtering by someone else's application shows nothing.
  await create(other, { applicationId: otherApp });
  assert.equal((await reminders.listReminders(owner, q({ applicationId: otherApp }))).items.length, 0);
  // Suggestions for another user's application are not available.
  await apps.updateApplication(other, otherApp, { interviewAt: isoMinute(3 * DAY) });
  assert.equal((await reminders.getSuggestions(owner, '2026-01-01', otherApp)).length, 0);
  assert.equal(await reminders.acceptSuggestion(owner, { applicationId: otherApp, kind: 'interview', timeZone: 'UTC', leadMinutes: 60, time: '09:00', asOf: '2026-01-01' }), 'application_not_found');
});

test('SQL suggestions: from real dates only, confirmed once, never duplicated', { skip }, async () => {
  const u = await user();
  const today = new Date().toISOString().slice(0, 10);
  const followUp = new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10);
  const interviewAt = isoMinute(3 * DAY);
  const withDates = await application(u, { jobTitle: 'Engineer', companyName: 'Globex', interviewAt, followUpOn: followUp });
  await application(u, { jobTitle: 'No dates' });
  await application(u, { status: 'rejected', interviewAt: isoMinute(4 * DAY) });
  await application(u, { interviewAt: isoMinute(-DAY), followUpOn: '2020-01-01' });

  const suggestions = await reminders.getSuggestions(u, today);
  assert.deepEqual(suggestions.map((s) => [s.applicationId, s.kind, s.eventAt]), [
    [withDates, 'interview', interviewAt],
    [withDates, 'follow_up', followUp],
  ], 'only open applications, only dates still ahead, nothing invented');
  assert.equal(suggestions[0].suggestedTitle, 'Interview: Engineer at Globex');
  // Looking again does not create anything.
  assert.equal((await reminders.listReminders(u, q())).items.length, 0);

  const accept = (o: Partial<reminders.AcceptInput>) =>
    reminders.acceptSuggestion(u, { applicationId: withDates, kind: 'interview', timeZone: 'Asia/Kolkata', leadMinutes: 1440, time: '09:00', asOf: today, ...o });
  const first = await accept({});
  assert.ok(typeof first === 'object' && first.created);
  let r = (await reminders.getReminder(u, first.id))!;
  assert.deepEqual([r.type, r.source, r.dueAt, r.timeZone], ['interview', 'application_interview', new Date(Date.parse(interviewAt) - DAY).toISOString().replace('.000Z', 'Z'), 'Asia/Kolkata']);
  // Repeating (or a double click) returns the same reminder.
  const again = await accept({ leadMinutes: 60 });
  assert.deepEqual(again, { id: first.id, created: false });
  const parallel = await Promise.all([accept({ kind: 'follow_up', time: '10:00' }), accept({ kind: 'follow_up', time: '10:00' }), accept({ kind: 'follow_up', time: '10:00' })]);
  assert.equal(new Set(parallel.map((p) => (p as any).id)).size, 1, 'concurrent confirmations save one reminder');
  assert.equal(parallel.filter((p) => (p as any).created).length, 1);
  r = (await reminders.getReminder(u, (parallel[0] as any).id))!;
  assert.deepEqual([r.type, r.dueLocal, r.timeZone], ['follow_up', `${followUp}T10:00`, 'Asia/Kolkata']);
  assert.equal((await reminders.listReminders(u, q())).items.length, 2);
  assert.equal((await reminders.getSuggestions(u, today)).length, 0, 'accepted suggestions are not offered again');

  // A dismissed reminder keeps the suggestion from coming back; a deleted one lets it return.
  await reminders.setStatus(u, first.id, 'dismissed');
  assert.equal((await reminders.getSuggestions(u, today)).length, 0);
  await reminders.deleteReminder(u, first.id);
  assert.equal((await reminders.getSuggestions(u, today)).length, 1);

  // Lead time that would already have passed, and dates that no longer exist.
  const soonApp = await application(u, { interviewAt: isoMinute(2 * HOUR) });
  assert.equal(await accept({ applicationId: soonApp, leadMinutes: 1440 }), 'in_past');
  assert.ok(typeof (await accept({ applicationId: soonApp, leadMinutes: 60 })) === 'object');
  const noDates = await application(u);
  assert.equal(await accept({ applicationId: noDates }), 'no_date');
  assert.equal(await accept({ applicationId: noDates, kind: 'follow_up' }), 'no_date');
  const closed = await application(u, { status: 'withdrawn', interviewAt: isoMinute(3 * DAY) });
  assert.equal(await accept({ applicationId: closed }), 'application_closed');
});

test('SQL reminders: changes to the application flag reminders, never delete them', { skip }, async () => {
  const u = await user();
  const interviewAt = isoMinute(3 * DAY);
  const followUp = new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10);
  const appId = await application(u, { interviewAt, followUpOn: followUp });
  const today = new Date().toISOString().slice(0, 10);
  const base = { applicationId: appId, timeZone: 'UTC', leadMinutes: 60, time: '09:00', asOf: today };
  const interview = (await reminders.acceptSuggestion(u, { ...base, kind: 'interview' })) as { id: string };
  const follow = (await reminders.acceptSuggestion(u, { ...base, kind: 'follow_up' })) as { id: string };
  const manual = await create(u, { applicationId: appId });
  const reason = async (id: string) => (await reminders.getReminder(u, id))!.mayBeOutdated;

  assert.deepEqual([await reason(interview.id), await reason(follow.id), await reason(manual)], [null, null, null]);
  await apps.updateApplication(u, appId, { interviewAt: isoMinute(4 * DAY) });
  assert.equal(await reason(interview.id), 'interview_changed');
  await apps.updateApplication(u, appId, { followUpOn: null });
  assert.equal(await reason(follow.id), 'follow_up_changed');
  // The rescheduled interview can be suggested again.
  assert.deepEqual((await reminders.getSuggestions(u, today, appId)).map((s) => s.kind), ['interview']);

  await apps.updateApplication(u, appId, { status: 'rejected' });
  assert.deepEqual([await reason(interview.id), await reason(manual)], ['application_closed', 'application_closed']);
  assert.equal((await reminders.getSummary(u)).counts.mayBeOutdated, 3);
  // Done reminders are not flagged.
  await reminders.setStatus(u, manual, 'completed');
  assert.equal(await reason(manual), null);

  assert.ok(await apps.deleteApplication(appId, u));
  const kept = (await reminders.listReminders(u, q())).items;
  assert.equal(kept.length, 3, 'deleting the application keeps its reminders');
  for (const r of kept) assert.deepEqual([r.application, r.applicationRemoved], [null, true]);
  assert.equal(await reason(interview.id), 'application_deleted');
  // Dismissing clears the flag from what still needs attention.
  await reminders.setStatus(u, interview.id, 'dismissed');
  assert.equal((await reminders.getSummary(u)).counts.mayBeOutdated, 1);
});
