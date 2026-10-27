"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  DEMO_INVESTIGATIONS,
  formatDateTime,
  formatMinor,
} from "@/lib/demo/demo-data";
import { Button } from "@/components/ui/button";
import { Badge, RiskBadge, ReviewStatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";

type QueueItem = {
  id: string;
  orderNumber: string;
  customerName: string;
  shippingCountry: string;
  amount: number;
  currency: string;
  orderStatus: "PENDING" | "APPROVED" | "HELD_FOR_REVIEW";
  createdAt: string;
  risk: { score: number; level: "LOW" | "MEDIUM" | "HIGH" } | null;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "fallback-demo" }
  | { kind: "error"; message: string }
  | { kind: "ready"; items: QueueItem[] };

/**
 * Review queue (Phase 3): HELD orders first (highest risk first), then
 * PENDING high-risk orders — all from the database through the validated
 * /api/orders endpoint. Falls back to the labelled demo queue when no
 * database is configured.
 */
export function ReviewQueue() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
    try {
      const [heldRes, pendingRes] = await Promise.all([
        fetch("/api/orders?status=HELD_FOR_REVIEW&sort=risk_high&pageSize=12", {
          signal: controller.signal,
        }),
        fetch("/api/orders?status=PENDING&band=HIGH&sort=risk_high&pageSize=12", {
          signal: controller.signal,
        }),
      ]);
      const held = (await heldRes.json().catch(() => null)) as
        | ({ items: QueueItem[] } & { error?: string })
        | null;
      const pending = (await pendingRes.json().catch(() => null)) as
        | ({ items: QueueItem[] } & { error?: string })
        | null;

      if (held?.error === "database_unconfigured" || pending?.error === "database_unconfigured") {
        setState({ kind: "fallback-demo" });
        return;
      }
      if (!heldRes.ok || !held || !pendingRes.ok || !pending) {
        setState({
          kind: "error",
          message:
            held?.error === "database_unreachable" || pending?.error === "database_unreachable"
              ? "Database is unreachable"
              : "The queue service returned an unexpected response",
        });
        return;
      }

      const merged = [...(held.items ?? []), ...(pending.items ?? [])];
      const seen = new Set<string>();
      setState({
        kind: "ready",
        items: merged.filter((item) => {
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        }),
      });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ kind: "error", message: "The queue service is unavailable." });
      }
    }

    void load();
    return () => controller.abort();
  }, [reloadKey]);

  /** Retry handlers set the loading state themselves (never the effect body). */
  function retry() {
    setState({ kind: "loading" });
    setReloadKey((k) => k + 1);
  }

  if (state.kind === "loading") {
    return (
      <ul role="list" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <li key={i} className="h-40 animate-pulse rounded-lg border border-line bg-surface" />
        ))}
      </ul>
    );
  }

  if (state.kind === "error") {
    return (
      <ErrorState
        title="Queue unavailable"
        description={`${state.message}. The review queue could not be loaded.`}
        retry={{ label: "Retry", onRetry: retry }}
      />
    );
  }

  if (state.kind === "fallback-demo") {
    return (
      <div>
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          <Badge tone="warning">Demo fallback</Badge>
          <span className="max-w-3xl flex-1 leading-5">
            No database is configured, so the Phase 1 demo queue is shown. Entries are read-only
            placeholders.
          </span>
          <Button variant="secondary" size="sm" onClick={retry}>
            Retry database
          </Button>
        </div>
        <ul role="list" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {DEMO_INVESTIGATIONS.map((inv) => (
            <li
              key={inv.orderId}
              className="rounded-lg border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    {inv.number}
                    <ReviewStatusBadge status={inv.status} />
                  </p>
                  <p className="mt-1 truncate text-sm text-muted">
                    {inv.customer} · {inv.country}
                  </p>
                </div>
                <RiskBadge score={inv.riskScore} band={inv.riskBand} />
              </div>
              <p className="mt-3 flex items-baseline justify-between">
                <span className="text-xs text-muted">Order total</span>
                <span className="font-semibold tabular-nums">
                  {formatMinor(inv.totalMinor, inv.currency)}
                </span>
              </p>
              <p className="mt-1 flex items-baseline justify-between">
                <span className="text-xs text-muted">Waiting since</span>
                <span className="text-xs">{formatDateTime(inv.waitingSince)}</span>
              </p>
              <p className="mt-3 rounded-md bg-background px-3 py-2 text-xs leading-5 text-muted">
                {inv.summary}
              </p>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (state.items.length === 0) {
    return (
      <EmptyState
        title="Queue is clear"
        description="No held orders and no high-risk pending orders right now."
      />
    );
  }

  return (
    <ul role="list" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {state.items.map((item) => (
        <li
          key={item.id}
          className="flex flex-col justify-between rounded-lg border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
        >
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <Link href={`/orders/${item.id}`} className="hover:underline">
                    {item.orderNumber}
                  </Link>
                  <ReviewStatusBadge status={item.orderStatus} />
                </p>
                <p className="mt-1 truncate text-sm text-muted">
                  {item.customerName} · {item.shippingCountry}
                </p>
              </div>
              {item.risk ? (
                <RiskBadge score={item.risk.score} band={item.risk.level} />
              ) : (
                <Badge tone="neutral">Not scored</Badge>
              )}
            </div>
            <p className="mt-3 flex items-baseline justify-between">
              <span className="text-xs text-muted">Order total</span>
              <span className="font-semibold tabular-nums">
                {formatMinor(item.amount, item.currency as "USD" | "EUR" | "GBP")}
              </span>
            </p>
            <p className="mt-1 flex items-baseline justify-between">
              <span className="text-xs text-muted">Placed</span>
              <span className="text-xs">{formatDateTime(new Date(item.createdAt).toISOString())}</span>
            </p>
          </div>
          <Link
            href={`/orders/${item.id}`}
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            Investigate
            <span aria-hidden="true">→</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
