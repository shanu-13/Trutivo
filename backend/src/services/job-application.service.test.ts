import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import * as resumeService from './resume.service';
import * as coverLetters from './cover-letter.service';
import * as apps from './job-application.service';
import type { ApplicationFields, ListQuery } from './job-application.service';

// Opt-in SQL tests (a database with migrations 001-013 applied):
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
const make = (o: Partial<ApplicationFields>): ApplicationFields => ({ ...EMPTY, jobTitle: 'Developer', companyName: 'Acme', status: 'wishlist', ...o });
const create = async (userId: string, o: Partial<ApplicationFields> = {}) => {
  const r = await apps.createApplication(userId, make(o));
  assert.ok(typeof r === 'object' && 'id' in r, JSON.stringify(r));
  return r.id;
};
const q = (o: Partial<ListQuery> = {}): ListQuery => ({ statuses: [], company: null, title: null, appliedFrom: null, appliedTo: null, sort: 'updated', order: 'desc', page: 1, limit: 20, asOf: '2026-10-26', ...o });
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, '.000Z');

test('SQL: create, read, update, delete; history recorded and kept across status changes', { skip }, async () => {
  const u = await user();
  const id = await create(u, { status: 'preparing', interviewAt: future(3), interviewType: 'video', followUpOn: '2026-11-01', notes: 'private note', contactEmail: 'r@x.com' });
  const a = (await apps.getApplication(id, u))!;
  assert.deepEqual([a.status, a.interviewType, a.followUpOn, a.appliedOn], ['preparing', 'video', '2026-11-01', null]);
  assert.equal(a.interviewAt, future(3).replace('.000Z', 'Z'));

  for (const [status] of [['applied'], ['assessment'], ['interview'], ['offer']] as const) await apps.updateApplication(u, id, { status });
  await apps.updateApplication(u, id, { appliedOn: '2026-10-01', notes: 'changed private note', contactPhone: '+91 99999 99999' });
  await apps.updateApplication(u, id, { interviewAt: future(5), interviewStage: 'Final round' });
  await apps.updateApplication(u, id, { interviewAt: null, followUpOn: null });
  await apps.updateApplication(u, id, { status: 'offer' }); // no change: no event
  const history = await apps.getHistory(id, u);
  assert.deepEqual(history.map((h: any) => h.type), [
    'created', 'interview_scheduled', 'follow_up_set',
    'status_changed', 'status_changed', 'status_changed', 'status_changed',
    'details_updated', 'interview_updated', 'interview_cleared', 'follow_up_cleared',
  ]);
  assert.deepEqual(history.filter((h: any) => h.type === 'status_changed').map((h: any) => `${h.fromStatus}>${h.toStatus}`), ['preparing>applied', 'applied>assessment', 'assessment>interview', 'interview>offer']);
  assert.deepEqual(history.find((h: any) => h.type === 'details_updated').details.fields.sort(), ['appliedOn', 'contactPhone', 'notes']);
  assert.ok(!JSON.stringify(history).includes('private note') && !JSON.stringify(history).includes('99999'), 'no note or contact content in history');

  // Withdrawing keeps the whole history.
  await apps.updateApplication(u, id, { status: 'withdrawn' });
  assert.equal((await apps.getHistory(id, u)).length, history.length + 1);

  assert.ok(await apps.deleteApplication(id, u));
  assert.equal(await apps.getApplication(id, u), null);
  const [rows]: any = await pool.execute('SELECT COUNT(*) as n FROM job_application_events WHERE application_id = ?', [id]);
  assert.equal(Number(rows[0].n), 0);
});

test('SQL: other users cannot read, change, delete or see history', { skip }, async () => {
  const a = await user();
  const b = await user();
  const id = await create(a);
  assert.equal(await apps.getApplication(id, b), null);
  assert.equal(await apps.updateApplication(b, id, { status: 'offer' }), 'not_found');
  assert.equal(await apps.deleteApplication(id, b), false);
  assert.deepEqual(await apps.getHistory(id, b), []);
  assert.equal((await apps.listApplications(b, q())).pagination.total, 0);
  assert.equal((await apps.getApplication(id, a))!.status, 'wishlist');
});

test('SQL: links must be the user’s own; deleted links are cleared, application kept', { skip }, async () => {
  const a = await user();
  const b = await user();
  const resume = (await resumeService.createResume(a, 'cv.pdf', `${uuidv4()}.pdf`, '/n.pdf', 1, 'application/pdf'))!;
  const v2 = (await resumeService.createResume(a, 'cv2.pdf', `${uuidv4()}.pdf`, '/n.pdf', 1, 'application/pdf', { versionOf: resume.id }))!;
  const otherResume = (await resumeService.createResume(b, 'b.pdf', `${uuidv4()}.pdf`, '/n.pdf', 1, 'application/pdf'))!;
  const jd = uuidv4();
  await pool.execute("INSERT INTO job_descriptions (id, user_id, title, description_text) VALUES (?, ?, 'Backend Developer', 'x')", [jd, a]);
  const letter = (await coverLetters.createCoverLetter(a, { title: 'Letter', roleTitle: null, companyName: null, content: 'x', tone: 'concise', length: 'short' }, null, null))!;

  assert.deepEqual(await apps.createApplication(a, make({ resumeId: otherResume.id })), { invalidLink: 'resumeId' });
  assert.deepEqual(await apps.createApplication(a, make({ jobDescriptionId: uuidv4() })), { invalidLink: 'jobDescriptionId' });
  const id = await create(a, { resumeId: v2.id, jobDescriptionId: jd, coverLetterId: letter });
  const linked = (await apps.getApplication(id, a))!;
  assert.deepEqual([linked.links.resume?.versionNumber, linked.links.jobDescription?.title, linked.links.coverLetter?.title], [2, 'Backend Developer', 'Letter']);
  assert.deepEqual(await apps.updateApplication(a, id, { resumeId: otherResume.id }), { invalidLink: 'resumeId' });

  await resumeService.deleteResume(v2.id, a);
  await pool.execute('DELETE FROM job_descriptions WHERE id = ?', [jd]);
  await coverLetters.deleteCoverLetter(letter, a);
  const after = (await apps.getApplication(id, a))!;
  assert.deepEqual([after.resumeId, after.jobDescriptionId, after.coverLetterId, after.links.resume], [null, null, null, null]);
});

test('SQL: filters, sorting and pagination', { skip }, async () => {
  const u = await user();
  await create(u, { companyName: 'Zeta Labs', jobTitle: 'Data Engineer', status: 'applied', appliedOn: '2026-03-01' });
  await create(u, { companyName: 'Acme 100%', jobTitle: 'Backend Developer', status: 'interview', appliedOn: '2026-05-01', interviewAt: future(10) });
  await create(u, { companyName: 'beta_corp', jobTitle: 'Frontend Developer', status: 'wishlist', followUpOn: '2026-10-28' });
  await create(u, { companyName: 'Gamma', jobTitle: 'QA Engineer', status: 'rejected', appliedOn: '2026-01-15', interviewAt: future(-10) });

  const titles = async (o: Partial<ListQuery>) => (await apps.listApplications(u, q(o))).items.map((i) => i.jobTitle);
  assert.deepEqual((await titles({ statuses: ['applied', 'interview'], sort: 'company', order: 'asc' })), ['Backend Developer', 'Data Engineer']);
  assert.deepEqual(await titles({ company: 'acme' }), ['Backend Developer'], 'case-insensitive');
  assert.deepEqual(await titles({ company: '%' }), ['Backend Developer'], '% is literal');
  assert.deepEqual(await titles({ company: '_' }), ['Frontend Developer'], '_ is literal');
  assert.deepEqual(await titles({ title: 'developer', sort: 'company', order: 'asc' }), ['Backend Developer', 'Frontend Developer']);
  assert.deepEqual(await titles({ appliedFrom: '2026-02-01', appliedTo: '2026-12-31', sort: 'applied', order: 'asc' }), ['Data Engineer', 'Backend Developer']);
  assert.deepEqual(await titles({ sort: 'applied', order: 'desc' }), ['Backend Developer', 'Data Engineer', 'QA Engineer', 'Frontend Developer'], 'no date last');
  assert.deepEqual(await titles({ sort: 'company', order: 'asc' }), ['Backend Developer', 'Frontend Developer', 'QA Engineer', 'Data Engineer']);
  // Upcoming: follow-up on 2026-10-28 (as of 2026-10-26) before the interview in 10 days; past interview and none last.
  const upcoming = await apps.listApplications(u, q({ sort: 'upcoming', order: 'asc' }));
  assert.equal(upcoming.items[0].jobTitle, 'Frontend Developer');
  assert.deepEqual(upcoming.items[0].nextAction, { type: 'follow_up', at: '2026-10-28' });
  assert.equal(upcoming.items[1].nextAction?.type, 'interview');
  assert.equal(upcoming.items.find((i) => i.jobTitle === 'QA Engineer')!.nextAction, null, 'past interview is not upcoming');
  const page2 = await apps.listApplications(u, q({ sort: 'company', order: 'asc', page: 2, limit: 3 }));
  assert.deepEqual([page2.items.map((i) => i.jobTitle), page2.pagination], [['Data Engineer'], { page: 2, limit: 3, total: 4, totalPages: 2 }]);
});

test('SQL: metrics count each application once, by documented rules', { skip }, async () => {
  const u = await user();
  const empty = await apps.getMetrics(u, '2026-10-26');
  assert.deepEqual([empty.total, empty.submitted, empty.upcomingInterviews, empty.offers, empty.rejections, empty.followUpsDue], [0, 0, 0, 0, 0, 0]);
  await create(u, { status: 'wishlist', followUpOn: '2026-10-20' }); // follow-up due
  await create(u, { status: 'preparing' });
  await create(u, { status: 'applied', appliedOn: '2026-10-01', followUpOn: '2026-10-26' }); // submitted, due today
  await create(u, { status: 'assessment' }); // submitted
  await create(u, { status: 'interview', interviewAt: future(2), followUpOn: '2026-10-30' }); // submitted, upcoming interview, follow-up not due
  await create(u, { status: 'offer', followUpOn: '2026-10-01' }); // submitted, offer, closed: not due
  await create(u, { status: 'rejected', interviewAt: future(-3) }); // submitted, rejection, past interview
  await create(u, { status: 'withdrawn', appliedOn: '2026-09-01' }); // submitted (had applied)
  await create(u, { status: 'withdrawn' }); // not submitted
  const m = await apps.getMetrics(u, '2026-10-26');
  assert.deepEqual(
    { total: m.total, submitted: m.submitted, upcomingInterviews: m.upcomingInterviews, offers: m.offers, rejections: m.rejections, followUpsDue: m.followUpsDue },
    { total: 9, submitted: 6, upcomingInterviews: 1, offers: 1, rejections: 1, followUpsDue: 2 }
  );
  assert.deepEqual(m.byStatus, { wishlist: 1, preparing: 1, applied: 1, assessment: 1, interview: 1, offer: 1, rejected: 1, withdrawn: 2 });
  assert.equal(Object.values(m.byStatus).reduce((a, b) => a + b, 0), m.total, 'every application in exactly one status');
});
