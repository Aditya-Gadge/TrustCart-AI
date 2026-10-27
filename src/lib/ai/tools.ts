import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { REASON_META } from "@/lib/risk/rules";
import {
  toolArgsSchemas,
  type ToolArgs,
  type VerifiedCitation,
} from "@/lib/ai/schemas";
import {
  getCopilotOrderContext,
  getRiskSignalCounts,
  listCopilotOrders,
  type CopilotOrderRow,
} from "@/db/copilot-data";

/**
 * Read-only copilot tools (Phase 4).
 *
 * Security model:
 * - FIXED tool set. The model can only choose a name + JSON args from this
 *   catalogue; there is no SQL tool, no shell tool, no write tool, and no
 *   generic "run query" escape hatch anywhere in the codebase.
 * - Every call passes through `executeToolCall`, which validates the tool
 *   name and Zod-validates the arguments BEFORE the database sees them.
 * - Tool results contain only whitelisted, capped fields. Untrusted stored
 *   strings (customer names, reviewer notes) are truncated so they cannot
 *   carry large injection payloads.
 * - Successful order-bearing results are registered as citation candidates;
 *   the orchestrator drops model citations that are not in this registry.
 */

export type ToolDeclarations = readonly {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}[];

export const COPILOT_TOOL_DECLARATIONS: ToolDeclarations = [
  {
    name: "get_order_investigation",
    description:
      "Fetch ONE order's full stored context by orderNumber (like TC-1234) or orderId: order facts, its deterministic risk snapshot with reason codes and evidence, recent review decisions, and payment statuses. Use for 'why was this order flagged?' questions.",
    parameters: {
      type: "OBJECT",
      properties: {
        orderId: { type: "STRING", description: "Internal order id (either this or orderNumber)" },
        orderNumber: { type: "STRING", description: "Human-facing order number, e.g. TC-1234" },
      },
    },
  },
  {
    name: "list_orders_awaiting_review",
    description:
      "List orders that still need merchant attention: PENDING orders plus orders HELD_FOR_REVIEW, highest risk first.",
    parameters: {
      type: "OBJECT",
      properties: {
        limit: { type: "INTEGER", description: "How many orders to return, 1-20 (default 10)" },
      },
    },
  },
  {
    name: "search_orders",
    description:
      "Search stored orders with fixed filters: free text, status, risk band, minimum amount in minor units, created-since date. Use for questions like 'summarize high-value orders created today'.",
    parameters: {
      type: "OBJECT",
      properties: {
        q: { type: "STRING", description: "Free text on order number, customer, or country" },
        status: { type: "STRING", description: "PENDING, APPROVED, or HELD_FOR_REVIEW" },
        band: { type: "STRING", description: "Risk band LOW, MEDIUM, or HIGH" },
        minAmountMinor: { type: "INTEGER", description: "Minimum amount in minor units (cents)" },
        createdSince: { type: "STRING", description: "ISO date/time; only orders created at or after this moment" },
        sort: { type: "STRING", description: "newest, oldest, amount_high, or risk_high" },
        limit: { type: "INTEGER", description: "How many orders to return, 1-20 (default 10)" },
      },
    },
  },
  {
    name: "get_dashboard_stats",
    description:
      "Aggregate dashboard statistics computed from stored risk-engine snapshots: totals by status and band, average score, 14-day trend.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "get_top_risk_signals",
    description:
      "Frequency of each risk reason code across all stored risk snapshots in the demo dataset. Use for 'which risk signals appear most often?'.",
    parameters: {
      type: "OBJECT",
      properties: {
        limit: { type: "INTEGER", description: "How many signals to return, 1-10 (default 5)" },
      },
    },
  },
  {
    name: "submit_answer",
    description:
      "REQUIRED final step: submit the answer to the user. Set answerType to STORED_DATA when the answer is grounded in tool results (cite the exact orderIds/orderNumbers/reasonCodes used), EXPLANATORY for general explanations without stored data, or CANNOT_ANSWER when the available data cannot answer the question (explain the gap in dataGap).",
    parameters: {
      type: "OBJECT",
      properties: {
        answer: { type: "STRING", description: "The complete answer text for the merchant (max 4000 chars)" },
        answerType: { type: "STRING", description: "STORED_DATA, EXPLANATORY, or CANNOT_ANSWER" },
        citations: {
          type: "ARRAY",
          description: "Evidence references for STORED_DATA answers: actual orderIds/orderNumbers and risk reason codes",
          items: {
            type: "OBJECT",
            properties: {
              orderId: { type: "STRING" },
              orderNumber: { type: "STRING" },
              reasonCodes: { type: "ARRAY", items: { type: "STRING" } },
            },
          },
        },
        dataGap: { type: "STRING", description: "For CANNOT_ANSWER: what data would be needed (max 500 chars)" },
      },
      required: ["answer", "answerType", "citations"],
    },
  },
] as const;

export const DATA_TOOL_NAMES = [
  "get_order_investigation",
  "list_orders_awaiting_review",
  "search_orders",
  "get_dashboard_stats",
  "get_top_risk_signals",
] as const;

export type DataToolName = (typeof DATA_TOOL_NAMES)[number];

/** Stored strings are data, not instructions — and size-capped. */
export function truncateUntrusted(value: string, max = 120): string {
  return value.length > max ? `${value.slice(0, max)}…[truncated]` : value;
}

function money(minor: number, currency: string): string {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

function rowToCitation(row: CopilotOrderRow): VerifiedCitation {
  return { orderId: row.orderId, orderNumber: row.orderNumber };
}

export type ToolExecution = {
  ok: boolean;
  result: Record<string, unknown>;
  citations: VerifiedCitation[];
};

/**
 * The ONLY bridge between the model and the database. Read-only by
 * construction: there is no code path here that mutates state, and the
 * Prisma calls are fixed queries with validated parameters.
 */
export async function executeToolCall(
  prisma: PrismaClient,
  rawName: string,
  rawArgs: unknown,
): Promise<ToolExecution> {
  if (
    typeof rawName !== "string" ||
    !(DATA_TOOL_NAMES as readonly string[]).includes(rawName)
  ) {
    return {
      ok: false,
      result: { error: "unknown_tool", message: "Tool is not available" },
      citations: [],
    };
  }

  const parsed = toolArgsSchemas[rawName as keyof typeof toolArgsSchemas].safeParse(
    rawArgs ?? {},
  );
  if (!parsed.success) {
    return {
      ok: false,
      result: {
        error: "invalid_args",
        message: "Arguments failed validation; no query was executed",
      },
      citations: [],
    };
  }
  const args = parsed.data as ToolArgs[keyof typeof toolArgsSchemas];

  try {
    switch (rawName) {
      case "get_order_investigation": {
        const identifier =
          "orderId" in args
            ? { orderId: (args as { orderId: string }).orderId }
            : { orderNumber: (args as { orderNumber: string }).orderNumber };
        const order = await getCopilotOrderContext(prisma, identifier);
        if (!order) {
          return {
            ok: true,
            result: {
              found: false,
              message:
                "No stored order matches this identifier. Use list or search tools to discover valid order numbers.",
            },
            citations: [],
          };
        }
        const reasonCodes = order.risk?.reasons.map((r) => r.code) ?? [];
        return {
          ok: true,
          result: {
            found: true,
            order: {
              ...order,
              customerName: truncateUntrusted(order.customerName),
              reviews: order.reviews.map((r) => ({
                ...r,
                note: r.note ? truncateUntrusted(r.note) : null,
              })),
            },
            note: "Risk reasons are deterministic demo heuristics, not fraud predictions.",
          },
          citations: [
            {
              orderId: order.orderId,
              orderNumber: order.orderNumber,
              reasonCodes,
            },
          ],
        };
      }

      case "list_orders_awaiting_review": {
        const { limit } = args as ToolArgs["list_orders_awaiting_review"];
        const [held, pending] = await Promise.all([
          listCopilotOrders(prisma, {
            status: "HELD_FOR_REVIEW",
            sort: "risk_high",
            limit,
          }),
          listCopilotOrders(prisma, {
            status: "PENDING",
            band: "HIGH",
            sort: "risk_high",
            limit,
          }),
        ]);
        const seen = new Set<string>();
        const orders = [...held, ...pending].filter((row) => {
          if (seen.has(row.orderId)) return false;
          seen.add(row.orderId);
          return true;
        });
        return {
          ok: true,
          result: { count: orders.length, orders },
          citations: orders.map(rowToCitation),
        };
      }

      case "search_orders": {
        const filters = args as ToolArgs["search_orders"];
        const orders = await listCopilotOrders(prisma, {
          q: filters.q || undefined,
          status: filters.status,
          band: filters.band,
          minAmountMinor: filters.minAmountMinor,
          createdSince: filters.createdSince
            ? new Date(filters.createdSince)
            : undefined,
          sort: filters.sort,
          limit: filters.limit,
        });
        return {
          ok: true,
          result: { count: orders.length, orders },
          citations: orders.map(rowToCitation),
        };
      }

      case "get_dashboard_stats": {
        const { getDashboardStats } = await import("@/db/stats");
        const stats = await getDashboardStats(prisma);
        return {
          ok: true,
          result: { stats },
          citations: [],
        };
      }

      case "get_top_risk_signals": {
        const { limit } = args as ToolArgs["get_top_risk_signals"];
        const { totalAssessments, signals } = await getRiskSignalCounts(
          prisma,
          limit,
        );
        return {
          ok: true,
          result: {
            totalAssessments,
            signals: signals.map((signal) => ({
              ...signal,
              label: REASON_META[signal.code as keyof typeof REASON_META]?.label ?? signal.code,
            })),
            note: "Counts come from stored deterministic demo-heuristic snapshots.",
          },
          citations: [],
        };
      }

      default:
        return {
          ok: false,
          result: { error: "unknown_tool", message: "Tool is not available" },
          citations: [],
        };
    }
  } catch (error) {
    console.error(
      "[copilot:tool] database error:",
      error instanceof Error ? error.message : error,
    );
    return {
      ok: false,
      result: { error: "database_error", message: "Stored data is temporarily unavailable" },
      citations: [],
    };
  }
}

/** Human-facing summary helper reused by the UI fallback. */
export function formatMinorLabel(minor: number, currency: string): string {
  return money(minor, currency);
}
