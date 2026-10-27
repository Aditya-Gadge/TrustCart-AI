import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { getPrisma } from "@/db/client";

/**
 * Route-level tests for POST /api/copilot/chat with mocked modules: the
 * pre-flight gates (payload validation, rate limiting, unconfigured database
 * and provider) plus one streamed happy path with a fake orchestrator.
 * No network, no API key, no database writes.
 */

vi.mock("@/lib/ai/copilot", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ai/copilot")>();
  return {
    ...original,
    runCopilot: vi.fn(),
  };
});

const hasDatabaseUrl = process.env.DATABASE_URL !== undefined && process.env.DATABASE_URL !== "";

let prisma: PrismaClient;

async function post(body: unknown, ip = "10.0.0.1"): Promise<Response> {
  const { POST } = await import("@/app/api/copilot/chat/route");
  const request = new NextRequest("http://localhost:3000/api/copilot/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
  return POST(request);
}

describe.skipIf(!hasDatabaseUrl)("copilot chat route", () => {
  beforeAll(async () => {
    const client = getPrisma();
    if (!client) throw new Error("expected a configured Prisma client");
    prisma = client;

    // Ensure a Gemini config exists for the happy-path test (server-side only).
    process.env.GEMINI_API_KEY = "test-key-for-route-tests-1234567890";
    process.env.GEMINI_MODEL = "gemini-test-model";
  });

  afterAll(async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
    await prisma.$disconnect();
  }, 30_000);

  it("rejects malformed payloads with 400 invalid_payload", async () => {
    const res = await post({ question: "" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_payload");
  });

  it("rejects oversized questions with 400", async () => {
    const res = await post({ question: "q".repeat(1001) });
    expect(res.status).toBe(400);
  });

  it("returns 503 copilot_unconfigured when no API key is set", async () => {
    delete process.env.GEMINI_API_KEY;
    const res = await post({ question: "Which orders await review?" });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("copilot_unconfigured");
  });

  it("rate limits by client ip after the configured number of requests", async () => {
    process.env.GEMINI_API_KEY = "test-key-for-route-tests-1234567890";
    const { runCopilot } = await import("@/lib/ai/copilot");
    vi.mocked(runCopilot).mockImplementation(async function* () {
      yield { type: "status", message: "Checking stored data…" } as const;
      yield {
        type: "answer",
        payload: {
          answer: "Two orders await review.",
          answerType: "STORED_DATA",
          citations: [],
          dataSource: "STORED_DATA",
          disclaimer:
            "AI-generated explanation. Risk reasons are demo heuristics, not validated fraud predictions. The copilot is read-only: it never changes orders, decisions, scores, or payments.",
          model: "gemini-test-model",
          roundsUsed: 1,
        },
      } as const;
    } as unknown as typeof runCopilot);

    let lastResponse: Response | null = null;
    for (let attempt = 0; attempt < 11; attempt++) {
      lastResponse = await post({ question: `question ${attempt}` }, "10.9.9.9");
      if (lastResponse.status === 429) break;
      // Drain the stream so the limiter keeps counting real requests.
      await lastResponse.text();
    }
    expect(lastResponse?.status).toBe(429);
    const body = (await lastResponse!.json()) as { error: string; retryAfterMs: number };
    expect(body.error).toBe("rate_limited");
    expect(body.retryAfterMs).toBeGreaterThan(0);
  });

  it("streams NDJSON events: status then a validated structured answer", async () => {
    process.env.GEMINI_API_KEY = "test-key-for-route-tests-1234567890";
    const { runCopilot } = await import("@/lib/ai/copilot");
    vi.mocked(runCopilot).mockImplementation(async function* () {
      yield { type: "status", message: "Checking stored data (search_orders)…" } as const;
      yield {
        type: "answer",
        payload: {
          answer: "13 orders are high risk.",
          answerType: "STORED_DATA",
          citations: [],
          dataSource: "STORED_DATA",
          disclaimer:
            "AI-generated explanation. Risk reasons are demo heuristics, not validated fraud predictions. The copilot is read-only: it never changes orders, decisions, scores, or payments.",
          model: "gemini-test-model",
          roundsUsed: 2,
        },
      } as const;
    } as unknown as typeof runCopilot);

    const res = await post({ question: "How many high-risk orders exist?" }, "10.8.8.8");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");

    const text = await res.text();
    const events = text
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line));
    expect(events[0]?.type).toBe("status");
    const answer = events.find((event: { type: string }) => event.type === "answer");
    expect(answer.payload.dataSource).toBe("STORED_DATA");
    expect(answer.payload.disclaimer).toContain("read-only");
    // The API key must never appear anywhere in the streamed payload.
    expect(text).not.toContain("test-key-for-route-tests");
  });
});
