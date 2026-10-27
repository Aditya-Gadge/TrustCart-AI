import { afterEach, describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "@/lib/ratelimit";

describe("in-memory fixed-window rate limiter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to max requests per window then blocks with retry hint", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3 });
    expect(limiter.check("ip-1").allowed).toBe(true);
    expect(limiter.check("ip-1").allowed).toBe(true);
    expect(limiter.check("ip-1").allowed).toBe(true);
    const blocked = limiter.check("ip-1");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it("tracks clients independently", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
    expect(limiter.check("ip-a").allowed).toBe(true);
    expect(limiter.check("ip-a").allowed).toBe(false);
    expect(limiter.check("ip-b").allowed).toBe(true);
  });

  it("resets the window after it elapses", () => {
    vi.useFakeTimers();
    const limiter = createRateLimiter({ windowMs: 1_000, max: 1 });
    expect(limiter.check("ip-1").allowed).toBe(true);
    expect(limiter.check("ip-1").allowed).toBe(false);
    vi.advanceTimersByTime(1_500);
    expect(limiter.check("ip-1").allowed).toBe(true);
  });
});
