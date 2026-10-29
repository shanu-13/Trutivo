import jwt from 'jsonwebtoken';
import { config } from '../config/env';

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const UNITS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

// "7d", "12h", "3600" (seconds) -> milliseconds; the session cookie lasts exactly as long as the token.
export const parseExpiresIn = (value: string): number | null => {
  const m = /^(\d+)\s*([smhd]?)$/.exec(value.trim());
  if (!m || Number(m[1]) <= 0) return null;
  return Number(m[1]) * (m[2] ? UNITS[m[2]] : 1_000);
};

const expiresMs = parseExpiresIn(JWT_EXPIRES_IN);
if (expiresMs === null) {
  console.error('[config] JWT_EXPIRES_IN must be a number of seconds or a duration such as 12h or 7d.');
  process.exit(1);
}
export const SESSION_MAX_AGE_MS = expiresMs;

export const generateToken = (userId: string): string =>
  jwt.sign({ id: userId }, config.jwtSecret, { algorithm: 'HS256', expiresIn: Math.floor(SESSION_MAX_AGE_MS / 1000) });

// Only HS256 tokens signed with our secret are accepted (no "none" or other algorithms).
export const verifyToken = (token: string): { id: string } => {
  const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  if (typeof decoded !== 'object' || typeof decoded.id !== 'string') throw new Error('INVALID_TOKEN');
  return { id: decoded.id };
};
