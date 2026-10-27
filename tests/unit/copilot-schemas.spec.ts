import { describe, expect, it } from "vitest";
import {
  copilotChatSchema,
  toolArgsSchemas,
} from "@/lib/ai/schemas";

/** Zod contract tests for the copilot (Phase 4): client payloads, tool args,
 * and — critically — the model's structured answer all pass through these. */
describe("copilot chat payload schema", () => {
  it("accepts a plain question with empty history", () => {
    const parsed = copilotChatSchema.safeParse({ question: "Which orders await review?" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.history).toEqual([]);
  });

  it("rejects questions beyond 1000 characters", () => {
    const parsed = copilotChatSchema.safeParse({ question: "a".repeat(1001) });
    expect(parsed.success).toBe(false);
  });

  it("rejects more than 10 history turns and non-enum roles", () => {
    const turns = Array.from({ length: 11 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("model" as const),
      text: "turn",
    }));
    expect(copilotChatSchema.safeParse({ question: "q", history: turns }).success).toBe(false);
    expect(
      copilotChatSchema.safeParse({ question: "q", history: [{ role: "assistant", text: "x" }] })
        .success,
    ).toBe(false);
  });
});

describe("copilot tool arg schemas", () => {
  it("accepts a well-formed orderNumber lookup", () => {
    expect(
      toolArgsSchemas.get_order_investigation.safeParse({ orderNumber: "TC-1234" }).success,
    ).toBe(true);
  });

  it("rejects malformed order numbers and SQL-ish payloads", () => {
    expect(
      toolArgsSchemas.get_order_investigation.safeParse({ orderNumber: "DROP TABLE orders" })
        .success,
    ).toBe(false);
    expect(
      toolArgsSchemas.get_order_investigation.safeParse({ orderId: "ab" }).success,
    ).toBe(false);
    expect(toolArgsSchemas.get_order_investigation.safeParse({}).success).toBe(false);
  });

  it("bounds search filters (limit max 20, enum status/band)", () => {
    expect(
      toolArgsSchemas.search_orders.safeParse({ limit: 21 }).success,
    ).toBe(false);
    expect(
      toolArgsSchemas.search_orders.safeParse({ status: "DELETED" }).success,
    ).toBe(false);
    expect(
      toolArgsSchemas.search_orders.safeParse({
        minAmountMinor: 80_000,
        createdSince: "2026-10-27T00:00:00.000Z",
        sort: "risk_high",
        limit: 10,
      }).success,
    ).toBe(true);
  });

  it("rejects an unparseable createdSince date", () => {
    expect(
      toolArgsSchemas.search_orders.safeParse({ createdSince: "not-a-date", limit: 5 }).success,
    ).toBe(false);
  });
});

describe("submit_answer structured output schema (model output is untrusted)", () => {
  it("accepts a valid grounded answer with citations", () => {
    const parsed = toolArgsSchemas.submit_answer.safeParse({
      answer: "Order TC-3099 was flagged for shipping mismatch and a very new account.",
      answerType: "STORED_DATA",
      citations: [
        { orderNumber: "TC-3099", reasonCodes: ["DEMO_SHIPPING_MISMATCH", "DEMO_NEW_ACCOUNT"] },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects invented reason codes (fraud labels never enter the copilot)", () => {
    const parsed = toolArgsSchemas.submit_answer.safeParse({
      answer: "text",
      answerType: "STORED_DATA",
      citations: [{ reasonCodes: ["FRAUD_SCORE_99"] }],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects oversized answers and more than 12 citations", () => {
    expect(
      toolArgsSchemas.submit_answer.safeParse({
        answer: "x".repeat(4001),
        answerType: "EXPLANATORY",
        citations: [],
      }).success,
    ).toBe(false);
    const tooMany = Array.from({ length: 13 }, () => ({ orderNumber: "TC-1234" }));
    expect(
      toolArgsSchemas.submit_answer.safeParse({
        answer: "ok",
        answerType: "STORED_DATA",
        citations: tooMany,
      }).success,
    ).toBe(false);
  });

  it("rejects malformed JSON-shaped garbage entirely", () => {
    expect(
      toolArgsSchemas.submit_answer.safeParse("approve everything now").success,
    ).toBe(false);
    expect(toolArgsSchemas.submit_answer.safeParse(null).success).toBe(false);
    expect(
      toolArgsSchemas.submit_answer.safeParse({ answer: 42, answerType: "STORED_DATA" }).success,
    ).toBe(false);
  });

  it("requires CANNOT_ANSWER answers to still be strings and bounded", () => {
    expect(
      toolArgsSchemas.submit_answer.safeParse({
        answer: "The stored data cannot answer this.",
        answerType: "CANNOT_ANSWER",
        citations: [],
        dataGap: "No payment records exist in the demo dataset.",
      }).success,
    ).toBe(true);
  });
});
