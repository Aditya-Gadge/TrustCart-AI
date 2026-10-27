import { describe, expect, it } from "vitest";
import {
  isTransientProviderError,
  withBoundedBackoff,
} from "@/lib/ai/gemini";

/** Deterministic backoff tests — sleep is injected, no clock, no network. */
function fakeSleep(delays: number[]) {
  return async (ms: number) => {
    delays.push(ms);
  };
}

describe("isTransientProviderError (bounded-field classification)", () => {
  it.each([
    ["503 with high demand", new Error("503 UNAVAILABLE: high demand. Please try again later."), true],
    ["UNAVAILABLE status field", { status: "UNAVAILABLE", message: "model overloaded" }, true],
    ["fetch network failure", new TypeError("fetch failed"), true],
    ["transport timeout", new Error("provider timeout after 30000ms"), true],
    ["500 internal", new Error("500 Internal Server Error"), true],
    ["quota 429", new Error("429 RESOURCE_EXHAUSTED quota exceeded"), false],
    ["quota wording", { message: "quota exceeded for this project" }, false],
    ["rejected key", new Error("401 API key not valid"), false],
    ["permission denied", { status: "PERMISSION_DENIED" }, false],
    ["invalid argument", new Error("400 INVALID_ARGUMENT malformed contents"), false],
  ])("%s", (_label, error, expected) => {
    expect(isTransientProviderError(error)).toBe(expected);
  });
});

describe("withBoundedBackoff", () => {
  it("retries a transient UNAVAILABLE failure and succeeds on attempt 2", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const result = await withBoundedBackoff(
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("503 UNAVAILABLE high demand");
        return "pong";
      },
      { sleep: fakeSleep(delays) },
    );
    expect(result).toBe("pong");
    expect(attempts).toBe(2);
    expect(delays).toEqual([500]);
  });

  it("backs off exponentially: 500ms then 1000ms across three attempts", async () => {
    const delays: number[] = [];
    const attempts: number[] = [];
    const result = await withBoundedBackoff(
      async (attempt) => {
        attempts.push(attempt);
        if (attempt < 3) throw new Error("503 UNAVAILABLE");
        return attempt;
      },
      { sleep: fakeSleep(delays) },
    );
    expect(result).toBe(3);
    expect(attempts).toEqual([1, 2, 3]);
    expect(delays).toEqual([500, 1000]);
  });

  it("gives up after maxAttempts and rethrows the last transient error", async () => {
    const delays: number[] = [];
    let attempts = 0;
    await expect(
      withBoundedBackoff(
        async () => {
          attempts += 1;
          throw new Error("503 UNAVAILABLE high demand");
        },
        { sleep: fakeSleep(delays) },
      ),
    ).rejects.toThrow("503 UNAVAILABLE");
    expect(attempts).toBe(3);
    expect(delays).toEqual([500, 1000]);
  });

  it("never retries quota errors (429) — one attempt only", async () => {
    const delays: number[] = [];
    let attempts = 0;
    await expect(
      withBoundedBackoff(
        async () => {
          attempts += 1;
          throw new Error("429 RESOURCE_EXHAUSTED quota exceeded");
        },
        { sleep: fakeSleep(delays) },
      ),
    ).rejects.toThrow("429");
    expect(attempts).toBe(1);
    expect(delays).toEqual([]);
  });

  it("never retries auth errors (401) — one attempt only", async () => {
    const delays: number[] = [];
    let attempts = 0;
    await expect(
      withBoundedBackoff(
        async () => {
          attempts += 1;
          throw new Error("401 API key not valid");
        },
        { sleep: fakeSleep(delays) },
      ),
    ).rejects.toThrow("401");
    expect(attempts).toBe(1);
  });

  it("never retries non-transient errors (invalid argument)", async () => {
    const delays: number[] = [];
    let attempts = 0;
    await expect(
      withBoundedBackoff(
        async () => {
          attempts += 1;
          throw new Error("400 INVALID_ARGUMENT");
        },
        { sleep: fakeSleep(delays) },
      ),
    ).rejects.toThrow("INVALID_ARGUMENT");
    expect(attempts).toBe(1);
  });

  it("respects a custom shouldRetry predicate and maxAttempts", async () => {
    const delays: number[] = [];
    let attempts = 0;
    await expect(
      withBoundedBackoff(
        async () => {
          attempts += 1;
          throw new Error("custom transient");
        },
        {
          maxAttempts: 2,
          baseDelayMs: 25,
          sleep: fakeSleep(delays),
          shouldRetry: () => true,
        },
      ),
    ).rejects.toThrow("custom transient");
    expect(attempts).toBe(2);
    expect(delays).toEqual([25]);
  });
});
