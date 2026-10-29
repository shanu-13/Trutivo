import dotenv from 'dotenv';

dotenv.config();

// Startup configuration (Step 15). In production every security-relevant value
// must be set explicitly; development keeps its local defaults but says so.

export const isProduction = process.env.NODE_ENV === 'production';

const PLACEHOLDERS = new Set(['your_jwt_secret_here', 'change_me', 'changeme', 'secret', 'fallback_secret_do_not_use_in_prod']);
// Values copied unchanged from an .env.example.
const isPlaceholder = (value: string) => PLACEHOLDERS.has(value) || /^(replace[-_ ]with|your[-_ ])/i.test(value);
const SAME_SITE = ['lax', 'strict', 'none'] as const;
export type SameSite = (typeof SAME_SITE)[number];

export interface Config {
  jwtSecret: string;
  frontendOrigins: string[];
  cookieSameSite: SameSite;
  cookieSecure: boolean;
  trustProxy: boolean | number;
  enableTestRoutes: boolean;
}

// Returns the configuration and the problems found; production treats every problem as fatal.
export const readConfig = (env: NodeJS.ProcessEnv = process.env): { config: Config; errors: string[]; warnings: string[] } => {
  const get = (name: string) => (env[name] ?? '').trim();
  const production = env.NODE_ENV === 'production';
  const errors: string[] = [];
  const warnings: string[] = [];
  const problem = (message: string) => (production ? errors : warnings).push(message);

  let jwtSecret = get('JWT_SECRET');
  if (!jwtSecret || isPlaceholder(jwtSecret)) {
    problem('JWT_SECRET is not set (use a random value of at least 32 characters).');
    jwtSecret = production ? '' : 'dev-only-insecure-jwt-secret-change-me';
  } else if (jwtSecret.length < 32) {
    problem('JWT_SECRET must be at least 32 characters.');
  }

  const frontendOrigins = (get('FRONTEND_URL') || (production ? '' : 'http://localhost:3000'))
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (frontendOrigins.length === 0) errors.push('FRONTEND_URL is not set (the browser origin of the frontend, e.g. https://app.example.com).');
  for (const origin of frontendOrigins) {
    try {
      const u = new URL(origin);
      // http is only acceptable for localhost (e.g. the local Docker stack); browsers treat it as secure.
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
      if (production && u.protocol !== 'https:' && !local) problem(`FRONTEND_URL must use https in production (got ${origin}).`);
    } catch {
      errors.push(`FRONTEND_URL contains an invalid origin: ${origin}`);
    }
  }

  const sameSite = (get('COOKIE_SAMESITE') || 'lax').toLowerCase();
  if (!(SAME_SITE as readonly string[]).includes(sameSite)) errors.push('COOKIE_SAMESITE must be lax, strict or none.');
  const secureRaw = get('COOKIE_SECURE').toLowerCase();
  const cookieSecure = secureRaw ? secureRaw === 'true' : production;
  if (sameSite === 'none' && !cookieSecure) errors.push('COOKIE_SAMESITE=none requires COOKIE_SECURE=true (browsers reject it otherwise).');
  if (production && !cookieSecure) problem('COOKIE_SECURE must not be false in production.');

  const internalKey = get('INTERNAL_API_KEY');
  if (production && (!internalKey || isPlaceholder(internalKey))) problem('INTERNAL_API_KEY is not set (shared secret for calls to the AI service).');
  else if (production && internalKey.length < 32) problem('INTERNAL_API_KEY must be at least 32 characters.');
  if (production && (!get('DB_PASSWORD') || isPlaceholder(get('DB_PASSWORD')))) problem('DB_PASSWORD is not set.');
  if (production && !get('AI_SERVICE_URL')) problem('AI_SERVICE_URL is not set.');

  // Number of reverse proxies in front of the backend, so client IPs (rate limits) are read correctly.
  const proxyRaw = get('TRUST_PROXY');
  let trustProxy: boolean | number = false;
  if (proxyRaw) {
    if (/^\d+$/.test(proxyRaw)) trustProxy = Number(proxyRaw);
    else if (proxyRaw === 'true' || proxyRaw === 'false') trustProxy = proxyRaw === 'true';
    else errors.push('TRUST_PROXY must be a number of proxies, true or false.');
  }

  return {
    config: {
      jwtSecret,
      frontendOrigins,
      cookieSameSite: sameSite as SameSite,
      cookieSecure,
      trustProxy,
      // The database self-test route is for local development only.
      enableTestRoutes: !production && get('ENABLE_TEST_ROUTES') === 'true',
    },
    errors,
    warnings,
  };
};

const loaded = readConfig();
for (const w of loaded.warnings) console.warn(`[config] ${w}`);
if (loaded.errors.length) {
  // Only the names of the problems are printed, never the values.
  console.error(`[config] Invalid configuration:\n${loaded.errors.map((e) => `  - ${e}`).join('\n')}`);
  process.exit(1);
}

export const config = loaded.config;
