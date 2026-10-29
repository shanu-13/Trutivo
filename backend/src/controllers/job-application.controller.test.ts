import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSchema, parseListQuery, updateSchema, MAX_PAGE_SIZE } from './job-application.controller';
import { APPLICATION_STATUSES } from '../services/job-application.service';

const fields = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) => (r.error?.issues ?? []).map((i) => i.path.join('.'));

test('create: only job title and company are required; status defaults to wishlist', () => {
  const r = createSchema.parse({ jobTitle: '  Backend   Developer ', companyName: 'Test Co' });
  assert.equal(r.jobTitle, 'Backend Developer');
  assert.equal(r.status, 'wishlist');
  assert.equal(r.appliedOn, undefined, 'never set automatically');
  assert.deepEqual(fields(createSchema.safeParse({ companyName: 'X' })), ['jobTitle']);
  assert.deepEqual(fields(createSchema.safeParse({ jobTitle: '   ', companyName: 'X' })), ['jobTitle']);
  assert.deepEqual(fields(createSchema.safeParse({ jobTitle: 'X', companyName: '' })), ['companyName']);
});

test('every status is accepted; others are not', () => {
  for (const status of APPLICATION_STATUSES) assert.equal(createSchema.safeParse({ jobTitle: 'X', companyName: 'Y', status }).success, true, status);
  for (const status of ['hired', 'APPLIED', '', null]) assert.equal(createSchema.safeParse({ jobTitle: 'X', companyName: 'Y', status }).success, false, String(status));
});

test('URLs, e-mail, phone, dates and lengths are validated', () => {
  const base = { jobTitle: 'X', companyName: 'Y' };
  const bad: [Record<string, unknown>, string][] = [
    [{ postingUrl: 'javascript:alert(1)' }, 'postingUrl'],
    [{ postingUrl: 'example.com/job' }, 'postingUrl'],
    [{ postingUrl: `https://x.com/${'a'.repeat(2050)}` }, 'postingUrl'],
    [{ contactEmail: 'not-an-email' }, 'contactEmail'],
    [{ contactPhone: 'call me' }, 'contactPhone'],
    [{ appliedOn: '2026-02-30' }, 'appliedOn'],
    [{ appliedOn: '2999-01-01' }, 'appliedOn'],
    [{ appliedOn: '26/10/2026' }, 'appliedOn'],
    [{ followUpOn: 'tomorrow' }, 'followUpOn'],
    [{ interviewAt: '2026-11-02 10:00' }, 'interviewAt'],
    [{ interviewType: 'carrier pigeon' }, 'interviewType'],
    [{ employmentType: 'gig' }, 'employmentType'],
    [{ notes: 'x'.repeat(5001) }, 'notes'],
    [{ jobTitle: 'x'.repeat(201) }, 'jobTitle'],
    [{ notes: 'bad\u0000' }, 'notes'],
    [{ resumeId: '1' }, 'resumeId'],
    [{ userId: 'someone' }, ''],
  ];
  for (const [extra, field] of bad) {
    const r = createSchema.safeParse({ ...base, ...extra });
    assert.equal(r.success, false, JSON.stringify(extra).slice(0, 60));
    if (field) assert.ok(fields(r).includes(field), `${field}: ${fields(r)}`);
  }
  const ok = createSchema.parse({
    ...base,
    postingUrl: 'https://jobs.example.com/123?ref=x',
    contactEmail: 'recruiter@example.com',
    contactPhone: '+91 (44) 1234-5678',
    appliedOn: '2026-10-20',
    interviewAt: '2026-11-02T10:00:00+05:30',
    followUpOn: '2026-11-10',
    notes: 'Line 1\r\nLine 2',
    location: '',
  });
  assert.equal(ok.interviewAt, '2026-11-02T04:30:00.000Z', 'stored in UTC');
  assert.equal(ok.notes, 'Line 1\nLine 2');
  assert.equal(ok.location, null, 'empty optional text means not set');
});

test('update: partial, nulls clear optional fields, required fields cannot be cleared', () => {
  assert.ok(updateSchema.safeParse({ status: 'offer' }).success);
  assert.ok(updateSchema.safeParse({ interviewAt: null, followUpOn: null }).success);
  assert.equal(updateSchema.safeParse({}).success, false);
  assert.equal(updateSchema.safeParse({ jobTitle: '' }).success, false);
  assert.equal(updateSchema.safeParse({ companyName: null }).success, false);
});

test('list query: filters, sorting and pagination are validated', () => {
  const ok = parseListQuery({ status: 'applied,interview', company: ' Acme ', sort: 'company', page: '2', limit: '50', appliedFrom: '2026-01-01', appliedTo: '2026-12-31' });
  assert.ok('query' in ok);
  assert.deepEqual([ok.query.statuses, ok.query.company, ok.query.sort, ok.query.order, ok.query.page, ok.query.limit], [['applied', 'interview'], 'Acme', 'company', 'asc', 2, 50]);
  const d = parseListQuery({});
  assert.ok('query' in d && d.query.sort === 'updated' && d.query.order === 'desc' && d.query.limit === 20);
  for (const bad of [{ status: 'hired' }, { sort: 'salary' }, { sort: 'company; DROP TABLE x' }, { order: 'up' }, { page: '0' }, { limit: String(MAX_PAGE_SIZE + 1) }, { limit: 'ten' }, { appliedFrom: '2026-13-01' }, { appliedFrom: '2026-05-01', appliedTo: '2026-04-01' }, { company: ['a', 'b'] }]) {
    assert.ok('issues' in parseListQuery(bad as Record<string, unknown>), JSON.stringify(bad));
  }
});
