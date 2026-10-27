import { describe, expect, it } from "vitest";
import {
  dropTrailingFailedTurn,
  toApiHistory,
  type ChatTurn,
} from "@/components/copilot/chat-history";

/**
 * Phase 6 regression (QA review finding): the copilot retry path used the
 * stale React closure, so the failed question was sent BOTH as the last
 * history turn AND as the current question. These helpers are extracted so
 * the history contract is testable as a pure function.
 */

const TURNS: ChatTurn[] = [
  { role: "user", text: "Why was TC-3099 flagged?" },
  { role: "model", response: { answer: "It fired the shipping-mismatch signal." } },
];

describe("copilot chat history helpers", () => {
  it("maps model turns to their answer text for the API history", () => {
    expect(toApiHistory(TURNS)).toEqual([
      { role: "user", text: "Why was TC-3099 flagged?" },
      { role: "model", text: "It fired the shipping-mismatch signal." },
    ]);
  });

  it("drops only the trailing failed user turn before a retry", () => {
    const withFailure: ChatTurn[] = [...TURNS, { role: "user", text: "failed question" }];
    expect(dropTrailingFailedTurn(withFailure, "failed question")).toEqual(TURNS);
  });

  it("keeps history untouched when the last turn is a different message", () => {
    expect(dropTrailingFailedTurn(TURNS, "failed question")).toEqual(TURNS);
    expect(dropTrailingFailedTurn([], "failed question")).toEqual([]);
  });

  it("never drops a failed question that is not the last turn", () => {
    const history = [
      { role: "user", text: "failed question" } as ChatTurn,
      ...TURNS,
    ];
    expect(dropTrailingFailedTurn(history, "failed question")).toEqual(history);
  });
});
