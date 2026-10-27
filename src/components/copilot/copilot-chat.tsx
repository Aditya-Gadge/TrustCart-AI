"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  dropTrailingFailedTurn,
  toApiHistory,
} from "@/components/copilot/chat-history";
import type { CopilotErrorCode, CopilotResponse } from "@/lib/ai/schemas";

/**
 * Merchant copilot chat (Phase 4).
 *
 * Honest data-source labelling: every model answer is explicitly marked as
 * grounded in stored data (with verifiable citations linking to real orders)
 * or as explanatory AI text. Provider failures degrade to a live STORED-data
 * fallback panel (real high-risk orders from /api/orders) — never fabricated
 * AI content.
 */

type ChatMessage =
  | { role: "user"; text: string }
  | {
      role: "model";
      response: CopilotResponse;
    };

type ConnectionError = {
  code: CopilotErrorCode;
  message: string;
  retryAfterMs?: number;
};

const FALLBACK_ERROR_CODES: readonly CopilotErrorCode[] = [
  "copilot_unconfigured",
  "quota_exhausted",
  "provider_unavailable",
  "database_unconfigured",
  "database_unreachable",
];

const SUGGESTED_QUESTIONS = [
  "Why was order TC-3099 flagged?",
  "Which orders are awaiting review?",
  "Summarize high-value orders created today.",
  "What risk signals appear most often in the current demo dataset?",
];

type FallbackOrder = {
  id: string;
  orderNumber: string;
  amount: number;
  currency: string;
  orderStatus: string;
  risk: { score: number; level: "LOW" | "MEDIUM" | "HIGH" } | null;
};

function SourceBadge({ response }: { response: CopilotResponse }) {
  if (response.dataSource === "STORED_DATA") {
    return (
      <Badge tone="info">
        Grounded in stored data · {response.citations.length} citation
        {response.citations.length === 1 ? "" : "s"}
      </Badge>
    );
  }
  if (response.dataSource === "NOT_ANSWERED") {
    return <Badge tone="warning">Cannot be answered from stored data</Badge>;
  }
  return <Badge tone="warning">Explanatory AI text (not stored data)</Badge>;
}

function Citations({ response }: { response: CopilotResponse }) {
  const orderCitations = response.citations.filter((c) => c.orderNumber || c.orderId);
  if (orderCitations.length === 0) return null;
  return (
    <ul role="list" className="mt-2 flex flex-wrap gap-2">
      {orderCitations.map((citation, index) => (
        <li key={`${citation.orderId ?? citation.orderNumber}-${index}`}>
          <Link
            href={`/orders/${citation.orderId ?? ""}`}
            className="inline-flex items-center gap-1 rounded border border-line bg-background px-2 py-0.5 text-xs text-muted hover:text-foreground"
          >
            Evidence: {citation.orderNumber ?? citation.orderId?.slice(-8)}
            {citation.reasonCodes && citation.reasonCodes.length > 0
              ? ` · ${citation.reasonCodes.join(", ")}`
              : ""}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function CopilotChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<ConnectionError | null>(null);
  const [fallbackOrders, setFallbackOrders] = useState<FallbackOrder[] | null>(null);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const busy = status !== null;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  async function loadFallbackOrders() {
    try {
      const res = await fetch("/api/orders?band=HIGH&sort=risk_high&pageSize=5");
      if (!res.ok) return;
      const body = (await res.json()) as { items?: FallbackOrder[] };
      setFallbackOrders(body.items ?? []);
    } catch {
      setFallbackOrders([]);
    }
  }

  async function send(question: string, history: ChatMessage[]) {
    setLastQuestion(question);
    setError(null);
    setFallbackOrders(null);
    setStatus("Connecting to the copilot…");

    try {
      const res = await fetch("/api/copilot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          history: toApiHistory(history),
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string; message?: string; retryAfterMs?: number }
          | null;
        const code = (body?.error ?? "provider_unavailable") as CopilotErrorCode;
        setError({
          code,
          message:
            body?.message ??
            (res.status === 429
              ? "Too many questions in a minute — please wait a moment."
              : "The copilot is unavailable."),
          retryAfterMs: body?.retryAfterMs,
        });
        setStatus(null);
        if (FALLBACK_ERROR_CODES.includes(code)) void loadFallbackOrders();
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setError({ code: "provider_unavailable", message: "The copilot response could not be read." });
        setStatus(null);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let answered = false;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim() === "") continue;
          const event = JSON.parse(line) as
            | { type: "status"; message: string }
            | { type: "answer"; payload: CopilotResponse }
            | { type: "error"; code: CopilotErrorCode; message: string };
          if (event.type === "status") {
            setStatus(event.message);
          } else if (event.type === "answer") {
            answered = true;
            setStatus(null);
            setMessages((current) => [
              ...current,
              { role: "model", response: event.payload },
            ]);
          } else {
            answered = true; // terminal event — do not keep the spinner
            setStatus(null);
            setError({ code: event.code, message: event.message });
            if (FALLBACK_ERROR_CODES.includes(event.code)) void loadFallbackOrders();
          }
        }
      }
      if (!answered) {
        setStatus(null);
        setError({ code: "provider_unavailable", message: "The copilot closed the connection without an answer." });
      }
    } catch {
      setStatus(null);
      setError({
        code: "provider_unavailable",
        message: "Network error while contacting the copilot. Try again.",
      });
    } finally {
      setStatus(null);
    }
  }

  function submit(questionRaw: string) {
    const question = questionRaw.trim();
    if (question.length === 0 || busy) return;
    if (question.length > 1000) {
      setError({ code: "invalid_payload", message: "Questions are limited to 1000 characters." });
      return;
    }
    setMessages((current) => [...current, { role: "user", text: question }]);
    setInput("");
    void send(question, messages);
  }

  function retry() {
    if (lastQuestion === null || busy) return;
    // Drop the failed user turn SYNCHRONOUSLY from the current state (no
    // stale-closure race): the question is sent as `question`, so sending it
    // as trailing history too would double-count it in the 10-turn budget.
    const trimmed = dropTrailingFailedTurn(messages, lastQuestion);
    setMessages(trimmed);
    void send(lastQuestion, trimmed);
  }

  function clearConversation() {
    if (busy) return;
    setMessages([]);
    setError(null);
    setFallbackOrders(null);
    setLastQuestion(null);
    setConversationId((id) => id + 1);
  }

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <p className="text-xs text-muted">
          Read-only copilot — grounded in the live demo database. It cannot
          change orders, decisions, scores, or payments.
        </p>
        {messages.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={clearConversation}>
            Clear conversation
          </Button>
        ) : null}
      </div>

      <div
        ref={scrollRef}
        aria-live="polite"
        className="max-h-[60vh] min-h-64 space-y-4 overflow-y-auto p-4"
      >
        {messages.length === 0 && status === null && error === null ? (
          <div className="space-y-2">
            <p className="text-sm text-muted">
              Ask about stored orders, risk reasons, reviews, or dataset
              statistics. Example questions:
            </p>
            <ul role="list" className="space-y-2">
              {SUGGESTED_QUESTIONS.map((question) => (
                <li key={question}>
                  <button
                    type="button"
                    onClick={() => submit(question)}
                    className="w-full rounded-md border border-line bg-background px-3 py-2 text-left text-xs leading-5 text-muted hover:text-foreground"
                  >
                    “{question}”
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {messages.map((message, index) =>
          message.role === "user" ? (
            <p
              key={`u-${conversationId}-${index}`}
              className="ml-auto max-w-[85%] rounded-lg bg-primary-soft px-3 py-2 text-sm"
            >
              {message.text}
            </p>
          ) : (
            <div
              key={`m-${conversationId}-${index}`}
              className="max-w-[90%] rounded-lg border border-line bg-background px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <SourceBadge response={message.response} />
                <span className="text-[10px] text-muted">{message.response.model}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{message.response.answer}</p>
              {message.response.dataGap ? (
                <p className="mt-1 text-xs text-muted">Gap: {message.response.dataGap}</p>
              ) : null}
              <Citations response={message.response} />
              <p className="mt-2 text-[10px] leading-4 text-muted">{message.response.disclaimer}</p>
            </div>
          ),
        )}

        {status !== null ? (
          <p className="flex items-center gap-2 text-xs text-muted" role="status">
            <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-primary" />
            {status}
          </p>
        ) : null}

        {error ? (
          <div role="alert" className="max-w-[90%] rounded-lg border border-danger/25 bg-danger-soft px-3 py-2">
            <p className="text-sm text-danger">{error.message}</p>
            {error.retryAfterMs ? (
              <p className="mt-1 text-xs text-muted">
                Try again in about {Math.ceil(error.retryAfterMs / 1000)}s.
              </p>
            ) : null}
            <div className="mt-2 flex gap-2">
              {lastQuestion ? (
                <Button variant="secondary" size="sm" onClick={retry}>
                  Retry question
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {fallbackOrders !== null ? (
          <div className="rounded-lg border border-line bg-background p-3">
            <p className="text-xs font-medium">
              Copilot unavailable — here is live stored data instead (high-risk
              orders right now):
            </p>
            {fallbackOrders.length === 0 ? (
              <p className="mt-2 text-xs text-muted">No high-risk orders in the database.</p>
            ) : (
              <ul role="list" className="mt-2 space-y-1">
                {fallbackOrders.map((order) => (
                  <li key={order.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <Link href={`/orders/${order.id}`} className="font-medium hover:underline">
                      {order.orderNumber}
                    </Link>
                    <span className="text-muted">
                      {order.risk
                        ? `${order.risk.level} · score ${order.risk.score} · demo heuristic`
                        : "Not scored"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>

      <form
        className="flex items-end gap-2 border-t border-line p-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit(input);
        }}
      >
        <label htmlFor="copilot-question" className="sr-only">
          Your question for the copilot
        </label>
        <textarea
          id="copilot-question"
          rows={1}
          value={input}
          maxLength={1000}
          disabled={busy}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit(input);
            }
          }}
          placeholder="Ask about orders, risk reasons, or reviews…"
          className="max-h-32 min-h-10 w-full resize-y rounded-md border border-line bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:opacity-60"
        />
        <Button type="submit" variant="primary" size="md" disabled={busy || input.trim().length === 0}>
          {busy ? "Thinking…" : "Send"}
        </Button>
      </form>
      <p className="border-t border-line px-3 py-2 text-[10px] text-muted">
        Answers citing stored data reference real order ids and risk reason codes from the
        database; answers marked “explanatory AI text” are general model output without stored
        evidence. Risk reasons are demo heuristics, not validated fraud predictions.
      </p>
    </div>
  );
}
