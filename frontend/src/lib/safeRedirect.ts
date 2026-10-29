// Where to go after logging in: an internal path from `?next=`, or the dashboard.
// Anything else (other sites, "//host", "/\\host", the auth pages themselves) is ignored.
export const afterLoginPath = (next: string | null) => {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/dashboard';
  if (/^\/(login|signup|register)(\/|\?|$)/.test(next)) return '/dashboard';
  return next;
};
