import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptSchema, createSchema, parseListQuery, updateSchema, NOTES_MAX } from './reminder.controller';
import { REMINDER_TYPES } from '../services/reminder.service';
import { MAX_PAGE_SIZE } from './job-application.controller';

const fields = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) => (r.error?.issues ?? []).map((i) => i.path.join('.'));
const base = { title: 'Call the recruiter', dueLocal: '2026-11-02T09:30', timeZone: 'Europe/London' };

test('create: title, due date-time and time zone are required; type defaults to custom', () => {
  const r = createSchema.parse({ ...base, title: '  Call   the recruiter ' });
  assert.equal(r.title, 'Call the recruiter');
  assert.equal(r.type, 'custom');
  assert.equal(r.applicationId, undefined, 'standalone by default');
  assert.deepEqual(fields(createSchema.safeParse({ dueLocal: base.dueLocal, timeZone: base.timeZone })), ['title']);
  assert.deepEqual(fields(createSchema.safeParse({ ...base, title: '   ' })), ['title']);
  assert.deepEqual(fields(createSchema.safeParse({ title: 'x', timeZone: 'UTC' })), ['dueLocal']);
  assert.deepEqual(fields(createSchema.safeParse({ title: 'x', dueLocal: base.dueLocal })), ['timeZone']);
});

test('create: every reminder type is accepted, others are not', () => {
  for (const type of REMINDER_TYPES) assert.equal(createSchema.safeParse({ ...base, type }).success, true, type);
  for (const type of ['email', 'Interview', '', null]) assert.equal(createSchema.safeParse({ ...base, type }).success, false, String(type));
});

test('create: dates, time zones, lengths, ids and unknown fields are validated', () => {
  const bad: [Record<string, unknown>, string][] = [
    [{ dueLocal: '2026-02-30T09:00' }, 'dueLocal'],
    [{ dueLocal: '2026-11-02T25:00' }, 'dueLocal'],
    [{ dueLocal: '2026-11-02' }, 'dueLocal'],
    [{ dueLocal: '2026-11-02T09:30:00Z' }, 'dueLocal'],
    [{ dueLocal: '1960-01-01T09:00' }, 'dueLocal'],
    [{ timeZone: 'Mars/Base' }, 'timeZone'],
    [{ timeZone: '+05:30' }, 'timeZone'],
    [{ title: 'x'.repeat(201) }, 'title'],
    [{ title: 'bad\u0007title' }, 'title'],
    [{ notes: 'n'.repeat(NOTES_MAX + 1) }, 'notes'],
    [{ applicationId: 'not-a-uuid' }, 'applicationId'],
  ];
  for (const [extra, field] of bad) assert.deepEqual(fields(createSchema.safeParse({ ...base, ...extra })), [field], JSON.stringify(extra).slice(0, 60));
  assert.equal(createSchema.safeParse({ ...base, userId: 'someone-else' }).success, false, 'a user id is never accepted from the client');
  assert.equal(createSchema.parse({ ...base, notes: '  line 1\r\nline 2  ' }).notes, 'line 1\nline 2');
  assert.equal(createSchema.parse({ ...base, notes: '   ' }).notes, null);
});

test('update: any subset, but not nothing', () => {
  assert.equal(updateSchema.safeParse({ title: 'New' }).success, true);
  assert.equal(updateSchema.safeParse({ timeZone: 'Asia/Kolkata' }).success, true);
  assert.equal(updateSchema.safeParse({ applicationId: null, notes: null }).success, true);
  assert.equal(updateSchema.safeParse({}).success, false);
  assert.equal(updateSchema.safeParse({ status: 'completed' }).success, false, 'status changes go through complete/dismiss/reopen');
});

test('accepting a suggestion: only allowed lead times and real times', () => {
  const ok = acceptSchema.parse({ applicationId: '0b6a8e0e-4bd3-4a3f-9b3e-5c1d3c7c9a11', kind: 'interview', timeZone: 'UTC' });
  assert.deepEqual([ok.leadMinutes, ok.time], [1440, '09:00']);
  const id = '0b6a8e0e-4bd3-4a3f-9b3e-5c1d3c7c9a11';
  assert.deepEqual(fields(acceptSchema.safeParse({ applicationId: id, kind: 'interview', timeZone: 'UTC', leadMinutes: 7 })), ['leadMinutes']);
  assert.deepEqual(fields(acceptSchema.safeParse({ applicationId: id, kind: 'follow_up', timeZone: 'UTC', time: '24:00' })), ['time']);
  assert.deepEqual(fields(acceptSchema.safeParse({ applicationId: id, kind: 'assessment', timeZone: 'UTC' })), ['kind']);
  // The date always comes from the application, never from the request.
  assert.equal(acceptSchema.safeParse({ applicationId: id, kind: 'interview', timeZone: 'UTC', dueAt: '2026-01-01T00:00:00Z' }).success, false);
});

test('list query: views, ranges, filters and pagination are validated', () => {
  const ok = parseListQuery({});
  assert.ok('query' in ok);
  assert.deepEqual([ok.query.view, ok.query.page, ok.query.limit], ['upcoming', 1, 20]);
  const r = parseListQuery({ view: 'completed', from: '2026-11-01T00:00:00+05:30', to: '2026-11-30T23:59:59.999+05:30', type: 'interview', page: '2', limit: '50' });
  assert.ok('query' in r);
  assert.deepEqual([r.query.from, r.query.to, r.query.type], ['2026-10-31T18:30:00.000Z', '2026-11-30T18:29:59.999Z', 'interview']);
  const bad: [Record<string, unknown>, string][] = [
    [{ view: 'later' }, 'view'],
    [{ from: '2026-11-01' }, 'from'],
    [{ from: 'yesterday' }, 'from'],
    [{ from: '2026-11-02T00:00:00Z', to: '2026-11-01T00:00:00Z' }, 'to'],
    [{ applicationId: "1' OR 1=1" }, 'applicationId'],
    [{ type: 'meeting' }, 'type'],
    [{ page: '0' }, 'page'],
    [{ limit: String(MAX_PAGE_SIZE + 1) }, 'limit'],
    [{ view: ['upcoming', 'overdue'] }, 'view'],
  ];
  for (const [query, field] of bad) {
    const p = parseListQuery(query);
    assert.ok('issues' in p, JSON.stringify(query));
    assert.deepEqual(p.issues.map((i) => i.field), [field], JSON.stringify(query));
  }
});
