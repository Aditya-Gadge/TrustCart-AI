import { NextResponse, type NextRequest } from "next/server";
import { getPrisma } from "@/db/client";
import { applyReviewAction } from "@/db/reviews";
import { reviewActionSchema } from "@/lib/validation/review-action";
import { createRateLimiter, clientKeyFromHeaders } from "@/lib/ratelimit";

/**
 * POST /api/orders/:id/review — record a merchant review decision.
 *
 * Server-side enforcement (never trusted from the client):
 * - Rate-limited per client key (Phase 6) → 429 rate_limited.
 * - Zod-validated body: action enum, required reason, expected `updatedAt`.
 * - The target status is DERIVED from the action and checked against the
 *   transition matrix; forged `status` fields in the body are ignored
 *   (unknown keys are stripped by the schema).
 * - Optimistic concurrency: mismatched `expectedUpdatedAt` → 409 stale_write.
 * - Invalid transition → 422 invalid_transition; unknown order → 404.
 * - Reviewer identity is set server-side (demo actor).
 */

// Generous for real merchant usage; exists to throttle runaway abuse.
const limiter = createRateLimiter({ windowMs: 60_000, max: 60 });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = limiter.check(clientKeyFromHeaders(request.headers.get("x-forwarded-for")));
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterMs: limited.retryAfterMs },
      { status: 429 },
    );
  }

  const prisma = getPrisma();
  if (!prisma) {
    return NextResponse.json({ error: "database_unconfigured" }, { status: 503 });
  }

  const { id } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_payload", message: "Body must be JSON" },
      { status: 400 },
    );
  }

  const parsed = reviewActionSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", message: "Action requires a valid reason and expectedUpdatedAt" },
      { status: 400 },
    );
  }

  const expectedUpdatedAt = new Date(parsed.data.expectedUpdatedAt);
  if (Number.isNaN(expectedUpdatedAt.getTime())) {
    return NextResponse.json(
      { error: "invalid_payload", message: "expectedUpdatedAt is not a valid date" },
      { status: 400 },
    );
  }

  try {
    const outcome = await applyReviewAction(
      prisma,
      id,
      parsed.data.action,
      parsed.data.reason,
      expectedUpdatedAt,
    );

    if (outcome.ok) {
      return NextResponse.json(
        {
          order: {
            id: outcome.order.id,
            orderNumber: outcome.order.orderNumber,
            orderStatus: outcome.order.orderStatus,
            updatedAt: outcome.order.updatedAt.toISOString(),
          },
          fromStatus: outcome.fromStatus,
          toStatus: outcome.toStatus,
          reviewId: outcome.reviewId,
          assessment: outcome.assessment,
        },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (outcome.code === "not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (outcome.code === "stale_write") {
      return NextResponse.json(
        { error: "stale_write", currentUpdatedAt: outcome.currentUpdatedAt },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "invalid_transition", fromStatus: outcome.fromStatus },
      { status: 422 },
    );
  } catch (error) {
    console.error(
      "[api/orders/:id/review] database error:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ error: "database_unreachable" }, { status: 503 });
  }
}
