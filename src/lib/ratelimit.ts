/**
 * Tiny in-memory fixed-window rate limiter (Phase 4).
 *
 * Scope limit (documented): this only works within ONE server instance and
 * resets on restart — sufficient for the single-instance hackathon demo,
 * not a distributed rate limiter. Keys never include secrets.
 *
 * Known demo limitation (documented, Phase 6 security review): behind no
 * trusted proxy, the key is derived from the client-supplied
 * `x-forwarded-for` header when present, so a caller CAN rotate that header
 * to evade a per-key limit. Without a trusted-proxy deployment there is no
 * spoof-free socket identity available in Next.js route handlers; this is
 * acceptable for the local demo and must be revisited for any real deploy.
 */
export type RateLimiter = {
  check: (key: string) => { allowed: boolean; retryAfterMs: number };
  readonly max: number;
  readonly windowMs: number;
};

/** Best-effort client key for in-process limiting (see the scope note above). */
export function clientKeyFromHeaders(forwardedFor: string | null): string {
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return "local";
}

export function createRateLimiter(options: {
  windowMs: number;
  max: number;
}): RateLimiter {
  const { windowMs, max } = options;
  const hits = new Map<string, { count: number; windowStart: number }>();

  return {
    max,
    windowMs,
    check(key: string) {
      const now = Date.now();

      // Opportunistic pruning so abandoned keys cannot grow the map forever.
      if (hits.size > 5000) {
        for (const [existingKey, entry] of hits) {
          if (now - entry.windowStart >= windowMs) hits.delete(existingKey);
        }
      }

      const entry = hits.get(key);
      if (!entry || now - entry.windowStart >= windowMs) {
        hits.set(key, { count: 1, windowStart: now });
        return { allowed: true, retryAfterMs: 0 };
      }
      if (entry.count < max) {
        entry.count += 1;
        return { allowed: true, retryAfterMs: 0 };
      }
      return { allowed: false, retryAfterMs: entry.windowStart + windowMs - now };
    },
  };
}
