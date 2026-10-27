import { z } from "zod";
import { REASON_META } from "@/lib/risk/rules";

/**
 * Zod contracts for the merchant copilot (Phase 4). Everything the model
 * produces is untrusted: the structured answer, tool arguments, and citations
 * are all validated here before the server acts on or forwards them.
 */

export const REASON_CODES = Object.keys(REASON_META) as [string, ...string[]];

/** A user question plus prior conversation turns (client-supplied, untrusted). */
export const copilotChatSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, "A question is required")
    .max(1000, "Questions are limited to 1000 characters"),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "model"]),
        text: z.string().min(1).max(1000),
      }),
    )
    .max(10, "Conversation history is limited to 10 turns")
    .default([]),
});

export type CopilotChatInput = z.infer<typeof copilotChatSchema>;

const untrustedText = (max: number) =>
  z.string().min(1).max(max);

/** Arguments for the read-only data tools. Enforced BEFORE any DB access. */
export const toolArgsSchemas = {
  get_order_investigation: z
    .union([
      z.object({ orderId: untrustedText(64) }),
      z.object({ orderNumber: untrustedText(24) }),
    ])
    .refine(
      (value) =>
        ("orderId" in value && value.orderId.length >= 8) ||
        ("orderNumber" in value && /^TC-\d{3,8}$/.test(value.orderNumber)),
      { message: "Provide a valid orderId or an orderNumber like TC-1234" },
    ),
  list_orders_awaiting_review: z
    .object({ limit: z.number().int().min(1).max(20).default(10) })
    .default({ limit: 10 }),
  search_orders: z.object({
    q: z.string().trim().max(100).default(""),
    status: z.enum(["PENDING", "APPROVED", "HELD_FOR_REVIEW"]).optional(),
    band: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
    minAmountMinor: z.number().int().min(0).max(100_000_000).optional(),
    createdSince: z
      .string()
      .refine((value) => !Number.isNaN(new Date(value).getTime()), {
        message: "createdSince must be a parseable ISO date",
      })
      .optional(),
    sort: z.enum(["newest", "oldest", "amount_high", "risk_high"]).default("risk_high"),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  get_dashboard_stats: z.object({}).default({}),
  get_top_risk_signals: z.object({ limit: z.number().int().min(1).max(10).default(5) }).default({ limit: 5 }),
  submit_answer: z.object({
    answer: untrustedText(4000),
    answerType: z.enum(["STORED_DATA", "EXPLANATORY", "CANNOT_ANSWER"]),
    citations: z
      .array(
        z.object({
          orderId: z.string().min(8).max(64).optional(),
          orderNumber: z.string().regex(/^TC-\d{3,8}$/).optional(),
          reasonCodes: z.array(z.enum(REASON_CODES)).max(10).optional(),
        }),
      )
      .max(12)
      .default([]),
    dataGap: untrustedText(500).optional(),
  }),
} as const;

export type ToolArgs = {
  [K in keyof typeof toolArgsSchemas]: z.infer<(typeof toolArgsSchemas)[K]>;
};

/** A citation that the server has verified against actual tool output. */
export type VerifiedCitation = {
  orderId?: string;
  orderNumber?: string;
  reasonCodes?: string[];
};

/** The final copilot payload sent to the browser (server-authored). */
export const copilotResponseSchema = z.object({
  answer: z.string(),
  answerType: z.enum(["STORED_DATA", "EXPLANATORY", "CANNOT_ANSWER"]),
  citations: z.array(
    z.object({
      orderId: z.string().optional(),
      orderNumber: z.string().optional(),
      reasonCodes: z.array(z.string()).optional(),
    }),
  ),
  dataGap: z.string().optional(),
  dataSource: z.enum(["STORED_DATA", "AI_TEXT", "NOT_ANSWERED"]),
  disclaimer: z.string(),
  model: z.string(),
  roundsUsed: z.number().int().min(1),
});

export type CopilotResponse = z.infer<typeof copilotResponseSchema>;

/** NDJSON event shapes streamed from POST /api/copilot/chat. */
export type CopilotStreamEvent =
  | { type: "status"; message: string }
  | { type: "answer"; payload: CopilotResponse }
  | { type: "error"; code: CopilotErrorCode; message: string };

export type CopilotErrorCode =
  | "invalid_payload"
  | "rate_limited"
  | "database_unconfigured"
  | "database_unreachable"
  | "copilot_unconfigured"
  | "quota_exhausted"
  | "provider_unavailable"
  | "model_output_invalid";
