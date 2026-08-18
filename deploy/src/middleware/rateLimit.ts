// Simple in-memory rate limiter for Hono
import { createMiddleware } from "hono/factory";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}, 5 * 60 * 1000).unref();

/**
 * Rate limit middleware.
 * @param maxRequests Max requests allowed within the window
 * @param windowMs Time window in milliseconds (default: 60s)
 */
export function rateLimit(maxRequests: number, windowMs = 60_000) {
  return createMiddleware(async (c, next) => {
    // Skip rate limiting in test mode
    if (process.env.VITEST) {
      await next();
      return;
    }

    const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
    const key = `rl:${ip}:${c.req.path}`;

    const now = Date.now();
    const entry = store.get(key);

    if (!entry || now > entry.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      await next();
      return;
    }

    if (entry.count >= maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.header("Retry-After", String(retryAfter));
      return c.json({ error: "Too many requests. Please try again later." }, 429);
    }

    entry.count++;
    await next();
  });
}
