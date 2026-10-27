import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ReviewStatusBadge, RiskBadge, Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { getPrisma } from "@/db/client";
import { getInvestigation } from "@/db/investigations";
import { RiskBreakdown, humanizeAuditAction } from "@/components/orders/risk-breakdown";
import { ReviewActions } from "@/components/orders/review-actions";
import { PayPalCheckout } from "@/components/payments/paypal-checkout";
import { getPayPalConfig } from "@/lib/payments/paypal";
import { formatMinor } from "@/lib/demo/demo-data";
import { ALLOWED_TRANSITIONS } from "@/lib/review/transitions";
import type { Metadata } from "next";

/**
 * Blocking route (per the Next.js Cache Components build guidance): this
 * investigation view renders per-request against the live database — its
 * `updatedAt` feeds the optimistic-concurrency guard, so a statically
 * prerendered shell would be incorrect. The app shell's `usePathname()`
 * cannot prerender for dynamic params outside a Suspense boundary.
 */
export const instant = false;

/**
 * Order investigation (Phase 3/5): real risk-engine breakdown with per-reason
 * evidence, merchant review actions (confirm + reason, server-enforced),
 * review history, PayPal Sandbox payment flow + payment history, and the
 * audit timeline. Server-rendered from the database.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `Investigate ${id.slice(-6)} — TrustCart AI` };
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{value}</dd>
    </div>
  );
}

function AuditSummary({ metadata }: { metadata: unknown }) {
  if (metadata === null || typeof metadata !== "object") {
    return <span className="text-xs text-muted">—</span>;
  }
  const meta = metadata as Record<string, unknown>;
  const bits: string[] = [];
  if (typeof meta.fromStatus === "string" && typeof meta.toStatus === "string") {
    bits.push(
      `${meta.fromStatus.replace(/_/g, " ")} → ${meta.toStatus.replace(/_/g, " ")}`,
    );
  }
  if (typeof meta.reason === "string") bits.push(`“${meta.reason}”`);
  if (typeof meta.rulesVersion === "string") bits.push(meta.rulesVersion);
  if (bits.length === 0) bits.push(JSON.stringify(metadata).slice(0, 120));
  return <span className="text-xs leading-5 text-muted">{bits.join(" · ")}</span>;
}

export default async function OrderInvestigationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const prisma = getPrisma();

  if (!prisma) {
    return (
      <div>
        <PageHeader title="Investigation" description="Order detail view." />
        <ErrorState
          title="Database is not configured"
          description="Set DATABASE_URL (see README) and seed the database to investigate orders."
        />
        <p className="mt-4 text-center">
          <Link href="/orders">
            <Button variant="secondary" size="sm">
              Back to orders
            </Button>
          </Link>
        </p>
      </div>
    );
  }

  let data: Awaited<ReturnType<typeof getInvestigation>>;
  try {
    data = await getInvestigation(prisma, id);
  } catch (error) {
    console.error("[orders/:id] database error:", error instanceof Error ? error.message : error);
    return (
      <div>
        <PageHeader title="Investigation" description="Order detail view." />
        <ErrorState
          title="Database is unreachable"
          description="The order could not be loaded. Retry once the database is back."
          retry={undefined}
        />
        <p className="mt-4 text-center">
          <Link href="/orders">
            <Button variant="secondary" size="sm">
              Back to orders
            </Button>
          </Link>
        </p>
      </div>
    );
  }

  if (!data) notFound();

  const { order, assessment, reviews, payments, auditEvents } = data;
  const allowedCount = ALLOWED_TRANSITIONS[order.orderStatus].length;
  // Public-by-design client id (the secret never leaves the server). The
  // checkout renders only for APPROVED orders without an active payment.
  const paypalClientId = getPayPalConfig()?.clientId ?? null;
  const activePayment = payments.find((payment) =>
    ["CREATED", "PAYER_APPROVED", "CAPTURED", "VERIFIED"].includes(payment.status),
  );
  const canStartCheckout =
    order.orderStatus === "APPROVED" && activePayment === undefined;

  return (
    <div>
      <p className="mb-2">
        <Link href="/orders" className="text-sm text-muted hover:text-foreground hover:underline">
          ← Back to orders
        </Link>
      </p>
      <PageHeader
        title={`Order ${order.orderNumber}`}
        description="Investigate signals, record a review decision, and follow the audit trail."
      />

      <div className="rounded-lg border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <ReviewStatusBadge status={order.orderStatus} />
            {assessment ? (
              <RiskBadge score={assessment.score} band={assessment.level} />
            ) : (
              <Badge tone="neutral">Not scored</Badge>
            )}
            <Badge tone="warning">Demo heuristic</Badge>
          </div>
          <p className="text-lg font-semibold tabular-nums">
            {formatMinor(order.amount, order.currency as "USD" | "EUR" | "GBP")}
          </p>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
          <MetaItem label="Customer" value={order.customerName} />
          <MetaItem label="Email" value={order.customerEmail} />
          <MetaItem label="Ship-to country" value={order.shippingCountry} />
          <MetaItem label="Items" value={String(order.itemCount)} />
          <MetaItem label="Account age" value={`${order.accountAgeDays} days`} />
          <MetaItem label="Orders · last 30d" value={String(order.recentOrderCount)} />
          <MetaItem label="Shipping mismatch" value={order.shippingMismatch ? "Flagged" : "No"} />
          <MetaItem
            label="Placed"
            value={`${order.createdAt.toISOString().replace("T", " ").slice(0, 16)} UTC`}
          />
          <MetaItem
            label="Last update"
            value={`${order.updatedAt.toISOString().replace("T", " ").slice(0, 16)} UTC`}
          />
        </dl>
      </div>

      {assessment ? (
        <RiskBreakdown
          orderNumber={order.orderNumber}
          score={assessment.score}
          level={assessment.level}
          reasons={assessment.reasons}
          rulesVersion={assessment.rulesVersion}
          assessedAt={assessment.createdAt}
        />
      ) : (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold">Risk assessment</h2>
          <EmptyState
            title="Not scored yet"
            description="This order has no stored risk snapshot. Recording a review decision re-scores it with the deterministic engine."
          />
        </section>
      )}

      <section aria-label="Review actions" className="mt-8 rounded-lg border border-line bg-surface p-5">
        <h2 className="mb-1 text-sm font-semibold">Review decision</h2>
        <p className="mb-3 text-xs text-muted">
          {allowedCount > 0
            ? "Confirming opens a dialog that requires a written reason. Decisions are validated server-side and audited."
            : ""}{" "}
          Concurrent decisions are detected — the second reviewer is asked to re-check instead of
          silently overwriting.
        </p>
        <ReviewActions
          orderId={order.id}
          orderNumber={order.orderNumber}
          status={order.orderStatus}
          updatedAt={order.updatedAt.toISOString()}
        />
      </section>

      <section aria-label="Review history" className="mt-8">
        <h2 className="mb-3 text-sm font-semibold">Review history</h2>
        {reviews.length === 0 ? (
          <EmptyState
            title="No reviews recorded"
            description="Review decisions appear here as soon as they are recorded."
          />
        ) : (
          <ul role="list" className="space-y-2">
            {reviews.map((review) => (
              <li key={review.id} className="rounded-lg border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ReviewStatusBadge status={review.decision} />
                    <span className="text-sm font-medium">{review.reviewerId}</span>
                  </div>
                  <span className="text-xs tabular-nums text-muted">
                    {review.createdAt.toISOString().replace("T", " ").slice(0, 16)} UTC
                  </span>
                </div>
                {review.note ? <p className="mt-2 text-sm text-muted">“{review.note}”</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Payments" className="mt-8">
        <h2 className="mb-3 text-sm font-semibold">Payments</h2>
        {canStartCheckout ? (
          <div className="mb-4">
            <PayPalCheckout
              orderId={order.id}
              orderNumber={order.orderNumber}
              amountLabel={formatMinor(order.amount, order.currency as "USD" | "EUR" | "GBP")}
              currency={order.currency}
              clientId={paypalClientId}
            />
          </div>
        ) : null}
        {order.orderStatus !== "APPROVED" && activePayment === undefined ? (
          <p className="mb-4 text-xs text-muted">
            Payments can be collected once the order is approved by a reviewer.
          </p>
        ) : null}
        {payments.length === 0 ? (
          <EmptyState
            title="No payment records yet"
            description="Payment rows are only ever created by the server-side PayPal Sandbox flow — none are fabricated for the demo."
          />
        ) : (
          <ul role="list" className="space-y-2">
            {payments.map((payment) => (
              <li key={payment.id} className="rounded-lg border border-line bg-surface p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {payment.provider} · {payment.status}
                  </span>
                  <span className="tabular-nums">
                    {formatMinor(payment.amount, payment.currency as "USD" | "EUR" | "GBP")}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  PayPal order {payment.providerOrderId ?? "—"}
                  {payment.providerCaptureId ? ` · capture ${payment.providerCaptureId}` : ""}
                  {payment.verifiedAt
                    ? ` · verified ${payment.verifiedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`
                    : " · not yet verified"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Audit timeline" className="mt-8">
        <h2 className="mb-3 text-sm font-semibold">Audit timeline</h2>
        {auditEvents.length === 0 ? (
          <EmptyState
            title="No audit events"
            description="Audit entries appear here for every recorded decision and system action."
          />
        ) : (
          <ol role="list" className="space-y-0">
            {auditEvents.map((event, index) => (
              <li key={event.id} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <span
                    aria-hidden="true"
                    className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                      event.action === "REVIEW_STATUS_CHANGED" ? "bg-primary" : "bg-muted"
                    }`}
                  />
                  {index < auditEvents.length - 1 ? (
                    <span aria-hidden="true" className="w-px flex-1 bg-line" />
                  ) : null}
                </div>
                <div className="pb-6">
                  <p className="text-sm font-medium">
                    {humanizeAuditAction(event.action)}
                    <span className="ml-2 text-xs font-normal text-muted">
                      by {event.actor} ·{" "}
                      {event.createdAt.toISOString().replace("T", " ").slice(0, 16)} UTC
                    </span>
                  </p>
                  <AuditSummary metadata={event.metadata} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
