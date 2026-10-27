import { Badge, RiskBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import type { InvestigationReason } from "@/db/investigations";
import { RISK_RULES_VERSION } from "@/lib/risk/rules";

/**
 * Explainability panel (Phase 3): renders the stored risk-engine snapshot —
 * score, band, rules version, and EVERY fired reason with the exact evidence
 * that supports it. Clearly labelled as demo heuristics, never as validated
 * fraud predictions.
 */
export function RiskBreakdown({
  orderNumber,
  score,
  level,
  reasons,
  rulesVersion,
  assessedAt,
}: {
  orderNumber: string;
  score: number;
  level: "LOW" | "MEDIUM" | "HIGH";
  reasons: InvestigationReason[];
  rulesVersion: string;
  assessedAt: Date;
}) {
  return (
    <section aria-label={`Risk breakdown for order ${orderNumber}`} className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Risk assessment</h2>
        <div className="flex items-center gap-2">
          <Badge tone="warning">Demo heuristic</Badge>
          <span className="font-mono text-xs text-muted" title="Rules version stamped on this snapshot">
            {rulesVersion}
          </span>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center gap-3">
          <RiskBadge score={score} band={level} />
          <p className="text-xs text-muted">
            Assessed {assessedAt.toISOString().replace("T", " ").slice(0, 16)} UTC · deterministic
            rules, same inputs always produce this exact score.
          </p>
        </div>

        <p className="mt-3 max-w-3xl rounded-md bg-background px-3 py-2 text-xs leading-5 text-muted">
          These are <strong>demo heuristics for the hackathon dataset</strong>, not validated
          fraud predictions. Each reason below lists the exact evidence (observed values and
          thresholds) that supports it. Known synthetic labels are never used as scoring inputs.
        </p>

        {reasons.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No risk signals fired"
              description="Every documented signal was evaluated and none reached its threshold."
            />
          </div>
        ) : (
          <ul role="list" className="mt-4 space-y-3">
            {reasons.map((reason) => (
              <li key={reason.code} className="rounded-lg border border-line bg-background p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold">{reason.label}</p>
                  <span
                    className={`text-sm font-semibold tabular-nums ${
                      reason.points > 0 ? "text-warning" : "text-muted"
                    }`}
                  >
                    {reason.points > 0 ? `+${reason.points}` : reason.points} pts
                  </span>
                </div>
                <p className="mt-1 text-sm leading-5 text-muted">{reason.explanation}</p>
                {reason.evidence && reason.evidence.length > 0 ? (
                  <dl className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                    {reason.evidence.map((item) => (
                      <div key={`${reason.code}:${item.label}`} className="flex justify-between gap-3 text-xs">
                        <dt className="text-muted">{item.label}</dt>
                        <dd className="text-right font-medium tabular-nums">{item.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="mt-2 text-xs text-muted">
                    No structured evidence was recorded for this reason (snapshot predates the
                    evidence format).
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 text-xs text-muted">
          Engine reference version in code:{" "}
          <span className="font-mono">{RISK_RULES_VERSION}</span>
          {rulesVersion !== RISK_RULES_VERSION
            ? " — this snapshot was produced by an older version; it is re-scored the next time a review action runs."
            : ""}
        </p>
      </div>
    </section>
  );
}

/** Compact humanizer for audit action codes in timelines. */
export function humanizeAuditAction(action: string): string {
  const words = action.toLowerCase().split("_");
  return words
    .map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}
