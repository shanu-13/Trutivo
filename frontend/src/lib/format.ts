// "Oct 1, 2026" in the viewer's locale.
export const formatDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

// "Oct 1, 2026, 9:00 AM" in the viewer's locale.
export const formatDateTime = (value: string) =>
  new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

// "245 KB" / "1.2 MB".
export const formatFileSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export const errorMessage = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

// A calendar date "2026-10-26" shown as "Oct 26, 2026" without time-zone shifts.
export const formatDay = (value: string) => {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

// Today's date in the viewer's own time zone, as YYYY-MM-DD.
export const todayLocal = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

// ISO time <-> value of an <input type="datetime-local"> (the viewer's local time).
export const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const fromLocalInput = (value: string) => new Date(value).toISOString();

// The viewer's IANA time zone, e.g. "Europe/London".
export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

// Every time zone the browser knows, with the viewer's own (and `extra`, e.g. a saved one) always included.
export const timeZoneOptions = (extra?: string) => {
  const zones = new Set<string>(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []);
  zones.add('UTC');
  zones.add(browserTimeZone());
  if (extra) zones.add(extra);
  return [...zones].sort();
};

// A reminder's due time in the viewer's local time, plus its own zone's time when that differs.
export const formatDue = (dueAt: string, timeZone: string) => {
  const local = formatDateTime(dueAt);
  if (timeZone === browserTimeZone()) return local;
  const there = new Date(dueAt).toLocaleString(undefined, { timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `${local} (${there} ${timeZone.replace(/_/g, ' ')})`;
};
