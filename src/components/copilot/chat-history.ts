/**
 * Pure helpers for building the copilot request history (Phase 6).
 *
 * Extracted from CopilotChat so the retry/history contract is testable as a
 * plain function — the component used to resend the failed question twice
 * (as trailing history AND as the current question) via a stale closure.
 */

export type ChatTurn =
  | { role: "user"; text: string }
  | { role: "model"; response: { answer: string } };

/** API history shape: model turns collapse to their answer text. */
export type ApiHistoryTurn = { role: "user" | "model"; text: string };

/** Map chat turns to the API's history format. */
export function toApiHistory(messages: ChatTurn[]): ApiHistoryTurn[] {
  return messages.map((message) => ({
    role: message.role,
    text: message.role === "user" ? message.text : message.response.answer,
  }));
}

/**
 * Remove the failed user turn before a retry — ONLY when it is the trailing
 * turn (otherwise history is kept untouched). The question itself is sent
 * separately as the current `question`, never as history too.
 */
export function dropTrailingFailedTurn<T extends ChatTurn>(
  messages: T[],
  failedQuestion: string,
): T[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user" || last.text !== failedQuestion) {
    return messages;
  }
  return messages.slice(0, -1);
}
