import { NextResponse, type NextRequest } from "next/server";
import { getPrisma } from "@/db/client";
import { getGeminiConfig, createGeminiTransport } from "@/lib/ai/gemini";
import { runCopilot, type CopilotRunEvent } from "@/lib/ai/copilot";
import { copilotChatSchema, type CopilotStreamEvent } from "@/lib/ai/schemas";
import { createRateLimiter, clientKeyFromHeaders } from "@/lib/ratelimit";

/**
 * POST /api/copilot/chat (Phase 4).
 *
 * Pre-flight (JSON status codes): rate limit → 429; Zod body → 400;
 * no DATABASE_URL → 503 database_unconfigured; no GEMINI_API_KEY → 503
 * copilot_unconfigured. Everything after pre-flight is an NDJSON stream of
 * CopilotStreamEvents — status lines during grounding, then one validated
 * structured answer, or a terminal user-safe error event (quota/provider
 * failures never expose the API key or raw provider messages).
 *
 * The GEMINI_API_KEY is read here, server-side, and never leaves this process.
 */

const limiter = createRateLimiter({ windowMs: 60_000, max: 10 });

function clientKey(request: NextRequest): string {
  return clientKeyFromHeaders(request.headers.get("x-forwarded-for"));
}

function eventLine(event: CopilotStreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export async function POST(request: NextRequest) {
  const limited = limiter.check(clientKey(request));
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterMs: limited.retryAfterMs },
      { status: 429 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_payload", message: "Body must be JSON" },
      { status: 400 },
    );
  }
  const parsed = copilotChatSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", message: "A question of at most 1000 characters is required" },
      { status: 400 },
    );
  }

  const prisma = getPrisma();
  if (!prisma) {
    return NextResponse.json(
      { error: "database_unconfigured", message: "Stored order data requires a configured database" },
      { status: 503 },
    );
  }

  const gemini = getGeminiConfig();
  if (!gemini) {
    return NextResponse.json(
      {
        error: "copilot_unconfigured",
        message:
          "The copilot is not configured. Set GEMINI_API_KEY (server-side only) — stored risk reasons remain available in the dashboard.",
      },
      { status: 503 },
    );
  }

  const transport = createGeminiTransport(gemini.apiKey);
  const { question, history } = parsed.data;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const push = (event: CopilotRunEvent) => {
        controller.enqueue(encoder.encode(eventLine(event)));
      };
      try {
        for await (const event of runCopilot({
          prisma,
          transport,
          model: gemini.model,
          question,
          history,
        })) {
          push(event);
        }
      } catch (error) {
        // Defensive: the orchestrator yields typed errors; anything reaching
        // here is an unexpected internal failure (still never a key leak).
        console.error(
          "[api/copilot/chat] internal error:",
          error instanceof Error ? error.message : error,
        );
        push({
          type: "error",
          code: "provider_unavailable",
          message: "The copilot hit an internal error. Try again shortly.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
