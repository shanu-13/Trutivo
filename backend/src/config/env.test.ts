import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { readConfig } from './env';
import { generateToken, parseExpiresIn, verifyToken } from '../utils/jwt';
import { rateLimitPerIp } from '../middleware/rate-limit.middleware';

const SECRET = 'x'.repeat(48);
const prod = { NODE_ENV: 'production', JWT_SECRET: SECRET, FRONTEND_URL: 'https://app.example.com', INTERNAL_API_KEY: 'k'.repeat(40), DB_PASSWORD: 'pw', AI_SERVICE_URL: 'http://ai:8000' };

test('development: missing values fall back with warnings, never errors', () => {
  const r = readConfig({});
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => w.includes('JWT_SECRET')));
  assert.deepEqual(r.config.frontendOrigins, ['http://localhost:3000']);
  assert.deepEqual([r.config.cookieSecure, r.config.cookieSameSite, r.config.enableTestRoutes], [false, 'lax', false]);
});

test('production: a complete configuration is accepted', () => {
  const r = readConfig(prod);
  assert.deepEqual(r.errors, []);
  assert.deepEqual([r.config.cookieSecure, r.config.cookieSameSite, r.config.jwtSecret], [true, 'lax', SECRET]);
});

test('production: weak or missing security settings stop startup', () => {
  const cases: [Record<string, string>, string][] = [
    [{ JWT_SECRET: '' }, 'JWT_SECRET is not set'],
    [{ JWT_SECRET: 'your_jwt_secret_here' }, 'JWT_SECRET is not set'],
    [{ JWT_SECRET: 'short-secret' }, 'at least 32'],
    [{ FRONTEND_URL: '' }, 'FRONTEND_URL is not set'],
    [{ FRONTEND_URL: 'http://app.example.com' }, 'https'],
    [{ FRONTEND_URL: 'not a url' }, 'invalid origin'],
    [{ COOKIE_SECURE: 'false' }, 'COOKIE_SECURE'],
    [{ COOKIE_SAMESITE: 'whatever' }, 'COOKIE_SAMESITE'],
    [{ INTERNAL_API_KEY: '' }, 'INTERNAL_API_KEY'],
    [{ INTERNAL_API_KEY: 'too-short' }, 'INTERNAL_API_KEY must be at least 32'],
    [{ INTERNAL_API_KEY: 'replace-with-another-64-random-hex-characters' }, 'INTERNAL_API_KEY is not set'],
    [{ JWT_SECRET: 'replace-with-64-random-hex-characters' }, 'JWT_SECRET is not set'],
    [{ DB_PASSWORD: 'replace-with-a-strong-app-password' }, 'DB_PASSWORD'],
    [{ DB_PASSWORD: '' }, 'DB_PASSWORD'],
    [{ TRUST_PROXY: 'maybe' }, 'TRUST_PROXY'],
  ];
  for (const [override, message] of cases) {
    const r = readConfig({ ...prod, ...override });
    assert.ok(r.errors.some((e) => e.includes(message)), `${JSON.stringify(override)} -> ${r.errors.join(' | ')}`);
    assert.ok(!r.errors.join(' ').includes(SECRET), 'secret values are never echoed');
  }
  assert.ok(readConfig({ ...prod, NODE_ENV: 'development', COOKIE_SAMESITE: 'none', COOKIE_SECURE: 'false' }).errors.some((e) => e.includes('COOKIE_SAMESITE=none')));
  assert.deepEqual(readConfig({ ...prod, FRONTEND_URL: 'http://localhost:3000' }).errors, [], 'localhost may use http (local Docker stack)');
});

test('production: test routes can never be enabled; several origins and proxies are supported', () => {
  assert.equal(readConfig({ ...prod, ENABLE_TEST_ROUTES: 'true' }).config.enableTestRoutes, false);
  assert.equal(readConfig({ ENABLE_TEST_ROUTES: 'true' }).config.enableTestRoutes, true);
  const r = readConfig({ ...prod, FRONTEND_URL: 'https://app.example.com/, https://www.example.com', TRUST_PROXY: '1', COOKIE_SAMESITE: 'none' });
  assert.deepEqual(r.errors, []);
  assert.deepEqual([r.config.frontendOrigins, r.config.trustProxy, r.config.cookieSameSite], [['https://app.example.com', 'https://www.example.com'], 1, 'none']);
});

test('the backend exits at startup with an invalid production configuration', () => {
  const root = path.resolve(__dirname, '../..');
  const result = spawnSync(process.execPath, ['--require', 'ts-node/register', '-e', "require('./src/config/env')"], {
    cwd: root,
    // dotenv never overrides variables that are already set, so the empty JWT_SECRET wins over any local .env.
    env: { PATH: process.env.PATH, NODE_ENV: 'production', JWT_SECRET: '' },
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid configuration/);
  assert.match(result.stderr, /JWT_SECRET is not set/);
});

test('session tokens: lifetime parsing, HS256 only, tampering rejected', () => {
  assert.equal(parseExpiresIn('7d'), 7 * 86_400_000);
  assert.equal(parseExpiresIn('12h'), 12 * 3_600_000);
  assert.equal(parseExpiresIn('3600'), 3_600_000);
  for (const bad of ['', '0', '-5', '7 days', 'abc']) assert.equal(parseExpiresIn(bad), null, bad);

  const token = generateToken('user-1');
  assert.equal(verifyToken(token).id, 'user-1');
  const [h, p] = token.split('.');
  assert.throws(() => verifyToken(`${h}.${p}.invalidsignature`));
  // An unsigned token ("alg": "none") is refused.
  const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${p}.`;
  assert.throws(() => verifyToken(none));
  // A token signed with another secret is refused, and so is an expired one.
  assert.throws(() => verifyToken(jwt.sign({ id: 'user-1' }, 'another-secret-another-secret-another')));
  const expired = jwt.sign({ id: 'user-1', exp: Math.floor(Date.now() / 1000) - 10 }, process.env.JWT_SECRET?.trim() || 'dev-only-insecure-jwt-secret-change-me');
  assert.throws(() => verifyToken(expired));
});

test('per-IP rate limit: blocks after the limit with 429, separately per address', () => {
  const limit = rateLimitPerIp('test', 2, 60_000);
  const call = (ip: string) => {
    let status = 200;
    let nextCalled = false;
    const res: any = { setHeader() {}, status(s: number) { status = s; return this; }, json() { return this; } };
    limit({ ip } as any, res, () => { nextCalled = true; });
    return nextCalled ? 200 : status;
  };
  assert.deepEqual([call('1.1.1.1'), call('1.1.1.1'), call('1.1.1.1'), call('2.2.2.2')], [200, 200, 429, 200]);
});

test('registration input is bounded: name, email and bcrypt-length passwords', async () => {
  const { registerSchema } = await import('../controllers/auth.controller');
  const ok = registerSchema.parse({ name: '  Asha   Test ', email: ' asha@example.com ', password: 'secret123' });
  assert.deepEqual([ok.name, ok.email], ['Asha Test', 'asha@example.com']);
  for (const bad of [
    { name: 'x'.repeat(101), email: 'a@b.co', password: 'secret123' },
    { name: 'A\u0000B', email: 'a@b.co', password: 'secret123' },
    { name: 'Asha', email: `${'a'.repeat(250)}@b.co`, password: 'secret123' },
    { name: 'Asha', email: 'a@b.co', password: 'é'.repeat(37) },
    { name: 'Asha', email: 'a@b.co', password: '12345' },
  ]) assert.equal(registerSchema.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 60));
});
