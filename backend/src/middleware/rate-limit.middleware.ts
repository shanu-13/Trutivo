import { Request, Response, NextFunction } from 'express';

// A small in-memory sliding-window limit, per user or per client IP, for expensive
// or sensitive endpoints (the project had no rate limiting before Step 12). It is per process: with
// several backend instances, each keeps its own count.
const rateLimit = (name: string, max: number, windowMs: number, keyOf: (req: Request) => string | undefined) => {
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyOf(req);
    if (!key) return next();
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      res.setHeader('Retry-After', String(Math.ceil((windowMs - (now - recent[0])) / 1000)));
      return res.status(429).json({
        success: false,
        message: 'Too many requests. Please wait a moment and try again.',
        error: { code: 'RATE_LIMITED', details: { limit: max, windowSeconds: windowMs / 1000, scope: name } },
      });
    }
    recent.push(now);
    hits.set(key, recent);
    // Forget users who have been idle for a whole window.
    if (hits.size > 10_000) for (const [k, times] of hits) if (now - times[times.length - 1] >= windowMs) hits.delete(k);
    next();
  };
};

export const rateLimitPerUser = (name: string, max: number, windowMs: number) => rateLimit(name, max, windowMs, (req) => req.user?.id);

// For unauthenticated endpoints (login, registration). Behind a proxy, set
// TRUST_PROXY so req.ip is the client's address rather than the proxy's.
export const rateLimitPerIp = (name: string, max: number, windowMs: number) => rateLimit(name, max, windowMs, (req) => req.ip);
