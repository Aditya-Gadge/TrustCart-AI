import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { CopilotChat } from "@/components/copilot/copilot-chat";

export const metadata: Metadata = {
  title: "AI Copilot",
};

/**
 * Merchant copilot (Phase 4): a Gemini-backed, server-side integration with
 * read-only tools over the demo database. Every answer is labelled with its
 * data source; provider failures degrade to live stored data, never fake AI.
 */
export default function CopilotPage() {
  return (
    <div>
      <PageHeader
        title="AI Copilot"
        description="Evidence-grounded answers about your orders, risk factors, and review decisions — read-only, built on authorized application data only."
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CopilotChat />
        </div>
        <aside aria-label="How the copilot works" className="rounded-lg border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold">How answers are produced</h2>
          <ul role="list" className="mt-3 space-y-3 text-xs leading-5 text-muted">
            <li>
              <strong className="text-foreground">Stored-data answers</strong> — the
              server calls fixed, read-only database queries (order facts, risk
              snapshots, aggregates) and the model cites the exact order ids and
              risk reason codes it was given. Citations are verified server-side.
            </li>
            <li>
              <strong className="text-foreground">Explanatory answers</strong> —
              general AI text without stored evidence, always labelled as such.
            </li>
            <li>
              <strong className="text-foreground">Limits</strong> — questions ≤ 1000
              characters, ≤ 4 model rounds, 1024 output tokens, 10 questions per
              minute.
            </li>
            <li>
              <strong className="text-foreground">Safety</strong> — the copilot has
              no write path: it cannot change decisions, scores, or payments, and
              there is no SQL or shell tool. When Gemini is unavailable or out of
              quota, the panel shows live stored data instead.
            </li>
          </ul>
          <p className="mt-4 text-xs text-muted">
            Risk reasons shown anywhere in this app are demo heuristics for the
            hackathon dataset — not validated fraud predictions.
          </p>
        </aside>
      </div>
    </div>
  );
}
