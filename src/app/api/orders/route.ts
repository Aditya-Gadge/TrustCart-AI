import { NextResponse, type NextRequest } from "next/server";
import { getPrisma } from "@/db/client";
import { listOrders } from "@/db/orders";
import { parseOrderQuery } from "@/lib/validation/order-query";

/**
 * GET /api/orders — validated, server-side paginated order search.
 * - invalid query parameters → 400 invalid_query
 * - no database configured → 503 database_unconfigured (UI falls back to demo)
 * - database unreachable → 503 database_unreachable
 * Clients send only query parameters; every predicate is validated here
 * and translated by the data layer. No client-supplied SQL fragments.
 */
export async function GET(request: NextRequest) {
  const parsed = parseOrderQuery(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: "invalid_query", message: "Malformed query parameters" },
      { status: 400 },
    );
  }

  const prisma = getPrisma();
  if (!prisma) {
    return NextResponse.json(
      { error: "database_unconfigured" },
      { status: 503 },
    );
  }

  try {
    const result = await listOrders(prisma, parsed.query);
    return NextResponse.json(result, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    // Any other database failure surfaces as a controlled 503 with no
    // internal details in the response body.
    console.error("[api/orders] database error:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "database_unreachable" },
      { status: 503 },
    );
  }
}
