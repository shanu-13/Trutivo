// Conversions between a wall-clock time in an IANA time zone and a UTC moment,
// using the time-zone rules built into Node (Intl). No time zone is ever
// guessed: an unknown name is rejected.

const formatters = new Map<string, Intl.DateTimeFormat>();
const formatter = (timeZone: string) => {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
};

export const isValidTimeZone = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(value)) return false;
  try {
    formatter(value);
    return true;
  } catch {
    return false;
  }
};

// The wall clock in `timeZone` at `ms`, as "YYYY-MM-DDTHH:mm".
export const toLocal = (ms: number, timeZone: string) => {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};

// Offset of `timeZone` from UTC at `ms`, in milliseconds (seconds ignored).
const offsetAt = (ms: number, timeZone: string) => {
  const local = toLocal(ms, timeZone);
  return Date.parse(`${local}:00Z`) - Math.floor(ms / 60_000) * 60_000;
};

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export const isLocalDateTime = (value: string) => {
  const m = LOCAL.exec(value);
  if (!m) return false;
  const ms = Date.parse(`${value}:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 16) === value;
};

export type LocalToUtc =
  | { ok: true; utc: string; ambiguous: boolean }
  | { ok: false; reason: 'invalid' | 'nonexistent' };

// "2026-03-29T09:30" in "Europe/London" -> the UTC moment, as ISO.
// A time skipped by a daylight-saving change (e.g. 02:30 when clocks jump from
// 02:00 to 03:00) does not exist and is refused rather than moved. A time that
// happens twice (clocks going back) resolves to the first occurrence.
export const localToUtc = (local: string, timeZone: string): LocalToUtc => {
  if (!isLocalDateTime(local) || !isValidTimeZone(timeZone)) return { ok: false, reason: 'invalid' };
  const asUtc = Date.parse(`${local}:00Z`);
  // Offsets either side of the date cover any transition close to it.
  const offsets = new Set([offsetAt(asUtc - 86_400_000, timeZone), offsetAt(asUtc, timeZone), offsetAt(asUtc + 86_400_000, timeZone)]);
  const matches = [...offsets].map((o) => asUtc - o).filter((ms) => toLocal(ms, timeZone) === local);
  const unique = [...new Set(matches)].sort((a, b) => a - b);
  if (unique.length === 0) return { ok: false, reason: 'nonexistent' };
  return { ok: true, utc: new Date(unique[0]).toISOString(), ambiguous: unique.length > 1 };
};

// The calendar date in `timeZone` at `ms`, as "YYYY-MM-DD".
export const localDate = (ms: number, timeZone: string) => toLocal(ms, timeZone).slice(0, 10);
