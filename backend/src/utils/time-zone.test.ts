import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocalDateTime, isValidTimeZone, localDate, localToUtc, toLocal } from './time-zone';

test('time zones: real IANA names only', () => {
  for (const tz of ['UTC', 'Europe/London', 'America/New_York', 'Asia/Kolkata', 'Australia/Lord_Howe', 'America/Argentina/Buenos_Aires']) assert.equal(isValidTimeZone(tz), true, tz);
  for (const tz of ['', 'Mars/Base', 'Europe/London; DROP', '../etc', 'x'.repeat(65), 5, null]) assert.equal(isValidTimeZone(tz), false, String(tz));
});

test('local date-times must be real calendar times', () => {
  assert.equal(isLocalDateTime('2026-11-02T09:30'), true);
  for (const v of ['2026-02-30T09:00', '2026-11-02T24:00', '2026-11-02 09:30', '2026-11-02T09:30:00', '2026-13-01T00:00', '']) assert.equal(isLocalDateTime(v), false, v);
  assert.deepEqual(localToUtc('2026-02-30T09:00', 'UTC'), { ok: false, reason: 'invalid' });
  assert.deepEqual(localToUtc('2026-11-02T09:30', 'Nowhere/City'), { ok: false, reason: 'invalid' });
});

test('local time to UTC, with fixed and half-hour offsets', () => {
  assert.deepEqual(localToUtc('2026-07-01T09:00', 'UTC'), { ok: true, utc: '2026-07-01T09:00:00.000Z', ambiguous: false });
  assert.equal((localToUtc('2026-07-01T09:00', 'Asia/Kolkata') as any).utc, '2026-07-01T03:30:00.000Z');
  // Crossing midnight: 02:00 in Tokyo is the previous UTC day.
  assert.equal((localToUtc('2026-07-01T02:00', 'Asia/Tokyo') as any).utc, '2026-06-30T17:00:00.000Z');
  assert.equal(toLocal(Date.parse('2026-06-30T17:00:00Z'), 'Asia/Tokyo'), '2026-07-01T02:00');
  assert.equal(localDate(Date.parse('2026-06-30T17:00:00Z'), 'Asia/Tokyo'), '2026-07-01');
});

test('daylight saving: summer and winter offsets differ for the same wall time', () => {
  assert.equal((localToUtc('2026-07-15T09:00', 'Europe/London') as any).utc, '2026-07-15T08:00:00.000Z');
  assert.equal((localToUtc('2026-12-15T09:00', 'Europe/London') as any).utc, '2026-12-15T09:00:00.000Z');
  assert.equal((localToUtc('2026-07-15T09:00', 'America/New_York') as any).utc, '2026-07-15T13:00:00.000Z');
  assert.equal((localToUtc('2026-12-15T09:00', 'America/New_York') as any).utc, '2026-12-15T14:00:00.000Z');
  // Southern hemisphere: Sydney is on daylight time in January.
  assert.equal((localToUtc('2026-01-15T09:00', 'Australia/Sydney') as any).utc, '2026-01-14T22:00:00.000Z');
});

test('daylight saving: skipped times are refused, repeated times use the first occurrence', () => {
  // Clocks jump from 01:00 to 02:00 (London) and 02:00 to 03:00 (New York).
  assert.deepEqual(localToUtc('2026-03-29T01:30', 'Europe/London'), { ok: false, reason: 'nonexistent' });
  assert.deepEqual(localToUtc('2026-03-08T02:30', 'America/New_York'), { ok: false, reason: 'nonexistent' });
  // Either side of the gap is fine.
  assert.equal((localToUtc('2026-03-29T00:59', 'Europe/London') as any).utc, '2026-03-29T00:59:00.000Z');
  assert.equal((localToUtc('2026-03-29T02:00', 'Europe/London') as any).utc, '2026-03-29T01:00:00.000Z');
  // Clocks go back: 01:30 happens twice; the first (still on summer time) is used.
  assert.deepEqual(localToUtc('2026-10-25T01:30', 'Europe/London'), { ok: true, utc: '2026-10-25T00:30:00.000Z', ambiguous: true });
  assert.deepEqual(localToUtc('2026-11-01T01:30', 'America/New_York'), { ok: true, utc: '2026-11-01T05:30:00.000Z', ambiguous: true });
  // Both occurrences display as the same wall time.
  assert.equal(toLocal(Date.parse('2026-10-25T00:30:00Z'), 'Europe/London'), '2026-10-25T01:30');
  assert.equal(toLocal(Date.parse('2026-10-25T01:30:00Z'), 'Europe/London'), '2026-10-25T01:30');
  // A 30-minute daylight-saving shift (Lord Howe Island: 02:00 -> 02:30).
  assert.deepEqual(localToUtc('2026-10-04T02:15', 'Australia/Lord_Howe'), { ok: false, reason: 'nonexistent' });
});

test('round trip: every half hour across a whole year in several zones', () => {
  for (const tz of ['Europe/London', 'America/New_York', 'Australia/Sydney', 'Asia/Kolkata']) {
    for (let ms = Date.parse('2026-01-01T00:00:00Z'); ms < Date.parse('2027-01-01T00:00:00Z'); ms += 30 * 60_000) {
      const local = toLocal(ms, tz);
      const back = localToUtc(local, tz);
      assert.ok(back.ok, `${tz} ${local}`);
      // A repeated hour resolves to the first occurrence, which displays the same.
      assert.equal(toLocal(Date.parse(back.utc), tz), local);
      if (!back.ambiguous) assert.equal(back.utc, new Date(ms).toISOString());
    }
  }
});
