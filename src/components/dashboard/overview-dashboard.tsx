"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  DEMO_KPIS,
  DEMO_TREND,
  latestOrders,
  formatDateTime,
  formatMinor,
  type DemoOrder,
} from "@/lib/demo/demo-data";
import { DataTable, type Column } from "@/components/ui/data-table";
import { KpiCard } from "@/components/ui/kpi-card";
import { TrendChart } from "@/components/chart/trend-chart";
import { Button } from "@/components/ui/button";
import { Badge, RiskBadge, ReviewStatusBadge } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui/error-state";
import {
  IconInvestigations,
  IconOrders,
  IconOverview,
} from "@/components/ui/icons";

type Stats = {
  totalOrders: number;
  pending: number;
  approved: number;
  held: number;
  highRisk: number;
  mediumRisk: number;
  lowRisk: number;
  avgRisk: number | null;
  trend: { day: string; orders: number; flagged: number }[];
};

type RecentOrder = {
  id: string;
  orderNumber: string;
  customerName: string;
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
  | { kind: "ready"; stats: Stats; recent: RecentOrder[] };

const recentColumns: Column<RecentOrder>[] = [
  {
    key: "number",
    header: "Order",
    render: (o) => (
      <Link href={`/orders/${o.id}`} className="font-medium hover:underline">
        {o.orderNumber}
      </Link>
    ),
  },
  { key: "customer", header: "Customer", render: (o) => o.customerName },
  {
    key: "total",
    header: "Total",
    numeric: true,
    render: (o) => formatMinor(o.amount, o.currency as "USD" | "EUR" | "GBP"),
  },
  {
    key: "risk",
    header: "Risk",
    render: (o) =>
      o.risk ? (
        <RiskBadge score={o.risk.score} band={o.risk.level} />
      ) : (
        <Badge tone="neutral">Not scored</Badge>
      ),
  },
  {
    key: "status",
    header: "Status",
    render: (o) => <ReviewStatusBadge status={o.orderStatus} />,
  },
  {
    key: "placedAt",
    header: "Placed",
    render: (o) => (
      <span className="whitespace-nowrap text-xs text-muted">
        {formatDateTime(new Date(o.createdAt).toISOString())}
      </span>
    ),
  },
];

const demoColumns: Column<DemoOrder>[] = [
  {
    key: "number",
    header: "Order",
    render: (o) => <span className="font-medium">{o.number}</span>,
  },
  { key: "customer", header: "Customer", render: (o) => o.customer },
  {
    key: "total",
    header: "Total",
    numeric: true,
    render: (o) => formatMinor(o.totalMinor, o.currency),
  },
  {
    key: "risk",
    header: "Risk",
    render: (o) => <RiskBadge score={o.riskScore} band={o.riskBand} />,
  },
  {
    key: "status",
    header: "Status",
    render: (o) => <ReviewStatusBadge status={o.reviewStatus} />,
  },
  {
    key: "placedAt",
    header: "Placed",
    render: (o) => (
      <span className="whitespace-nowrap text-xs text-muted">{formatDateTime(o.placedAt)}</span>
    ),
  },
];

function trendLabel(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Dashboard over the live database (Phase 3): KPIs, trend, and queue snapshot
 * come from stored risk-engine outputs via GET /api/stats. When no database
 * is configured, the Phase 1 demo dataset is shown behind an explicit Demo
 * banner — demo placeholders are never presented as live data.
 */
export function OverviewDashboard() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const [statsRes, ordersRes] = await Promise.all([
          fetch("/api/stats", { signal: controller.signal }),
          fetch("/api/orders?page=1&pageSize=6&sort=newest", { signal: controller.signal }),
        ]);

        const statsBody = (await statsRes.json().catch(() => null)) as
          | (Stats & { error?: string })
          | null;
        const ordersBody = (await ordersRes.json().catch(() => null)) as
          | ({ items: RecentOrder[] } & { error?: string })
          | null;

        if (statsBody?.error === "database_unconfigured" || ordersBody?.error === "database_unconfigured") {
          setState({ kind: "fallback-demo" });
          return;
        }
        if (!statsRes.ok || !statsBody || !ordersRes.ok || !ordersBody) {
          setState({
            kind: "error",
            message:
              statsBody?.error === "database_unreachable" || ordersBody?.error === "database_unreachable"
                ? "Database is unreachable"
                : "The dashboard service returned an unexpected response",
          });
          return;
        }
        // Explicit mapping keeps the Stats type exact without unused rest keys.
        const stats: Stats = {
          totalOrders: statsBody.totalOrders,
          pending: statsBody.pending,
          approved: statsBody.approved,
          held: statsBody.held,
          highRisk: statsBody.highRisk,
          mediumRisk: statsBody.mediumRisk,
          lowRisk: statsBody.lowRisk,
          avgRisk: statsBody.avgRisk,
          trend: statsBody.trend,
        };
        setState({
          kind: "ready",
          stats,
          recent: ordersBody.items ?? [],
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ kind: "error", message: "The dashboard service is unavailable." });
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
      <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-lg border border-line bg-surface" />
        ))}
      </section>
    );
  }

  if (state.kind === "fallback-demo") {
    return (
      <div>
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          <Badge tone="warning">Demo fallback</Badge>
          <span className="max-w-3xl flex-1 leading-5">
            No database is configured, so the Phase 1 synthetic demo dataset is shown. Configure
            DATABASE_URL and seed the database to see live risk-engine outputs.
          </span>
          <Button variant="secondary" size="sm" onClick={retry}>
            Retry database
          </Button>
        </div>
        <DashboardContent
          kpis={DEMO_KPIS.map((kpi, i) => (
            <KpiCard
              key={kpi.id}
              label={kpi.label}
              value={kpi.value}
              delta={kpi.delta}
              hint={kpi.hint}
              icon={[<IconOverview key="i0" />, <IconInvestigations key="i1" />, <IconOrders key="i2" />, null][i]}
            />
          ))}
          trend={
            <TrendChart
              ariaLabel="Demo order volume and flagged orders per day for the last 14 days."
              series={[
                {
                  label: "Orders",
                  color: "var(--primary)",
                  points: DEMO_TREND.map((p) => ({ label: p.label, value: p.orders })),
                },
                {
                  label: "Flagged",
                  color: "var(--danger)",
                  points: DEMO_TREND.map((p) => ({ label: p.label, value: p.flagged })),
                },
              ]}
            />
          }
          snapshot={
            <>
              <li className="flex justify-between">
                <span>Held for review</span>
                <span className="font-semibold tabular-nums">4</span>
              </li>
              <li className="flex justify-between">
                <span>Pending · high risk</span>
                <span className="font-semibold tabular-nums">3</span>
              </li>
              <li className="flex justify-between">
                <span>Average risk (demo)</span>
                <span className="font-semibold tabular-nums">64</span>
              </li>
            </>
          }
          recentTable={
            <DataTable
              columns={demoColumns}
              rows={latestOrders(6)}
              caption="Six most recent demo orders"
            />
          }
        />
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <ErrorState
        title="Dashboard unavailable"
        description={`${state.message}. KPIs and trends could not be loaded from the database.`}
        retry={{ label: "Retry", onRetry: retry }}
      />
    );
  }

  const { stats } = state;
  const demoKpiIcons = [
    <IconOverview key="i0" />,
    <IconInvestigations key="i1" />,
    <IconOrders key="i2" />,
    null,
  ];

  return (
    <DashboardContent
      kpis={[
        <KpiCard
          key="k0"
          label="Orders in database"
          value={stats.totalOrders.toLocaleString("en-US")}
          hint="Synthetic demo dataset served by PostgreSQL"
          icon={demoKpiIcons[0]}
        />,
        <KpiCard
          key="k1"
          label="Awaiting review"
          value={stats.pending.toLocaleString("en-US")}
          hint="PENDING review status"
          icon={demoKpiIcons[1]}
        />,
        <KpiCard
          key="k2"
          label="Held for review"
          value={stats.held.toLocaleString("en-US")}
          hint="Flagged HELD_FOR_REVIEW"
          icon={demoKpiIcons[2]}
        />,
        <KpiCard
          key="k3"
          label="High risk"
          value={stats.highRisk.toLocaleString("en-US")}
          hint="Score ≥ 70 by the demo heuristic engine"
          icon={demoKpiIcons[3] ?? undefined}
        />,
      ]}
      trend={
        stats.trend.length > 0 ? (
          <TrendChart
            ariaLabel="Order volume and high-risk orders per day over the most recent 14 days in the database."
            series={[
              {
                label: "Orders",
                color: "var(--primary)",
                points: stats.trend.map((p) => ({ label: trendLabel(p.day), value: p.orders })),
              },
              {
                label: "High risk",
                color: "var(--danger)",
                points: stats.trend.map((p) => ({ label: trendLabel(p.day), value: p.flagged })),
              },
            ]}
          />
        ) : (
          <p className="text-sm text-muted">No trend data available yet.</p>
        )
      }
      snapshot={
        <>
          <li className="flex justify-between">
            <span>Held for review</span>
            <span className="font-semibold tabular-nums">{stats.held}</span>
          </li>
          <li className="flex justify-between">
            <span>Awaiting review</span>
            <span className="font-semibold tabular-nums">{stats.pending}</span>
          </li>
          <li className="flex justify-between">
            <span>Average risk score</span>
            <span className="font-semibold tabular-nums">
              {stats.avgRisk === null ? "—" : stats.avgRisk}
            </span>
          </li>
          <li className="flex justify-between">
            <span>Medium risk orders</span>
            <span className="font-semibold tabular-nums">{stats.mediumRisk}</span>
          </li>
        </>
      }
      recentTable={
        state.recent.length === 0 ? (
          <p className="text-sm text-muted">
            No orders in the database yet — seed it (see README) to populate the dashboard.
          </p>
        ) : (
          <DataTable
            columns={recentColumns}
            rows={state.recent}
            caption="Six most recent orders from the database"
          />
        )
      }
    />
  );
}

function DashboardContent({
  kpis,
  trend,
  snapshot,
  recentTable,
}: {
  kpis: React.ReactNode[];
  trend: React.ReactNode;
  snapshot: React.ReactNode;
  recentTable: React.ReactNode;
}) {
  return (
    <div>
      <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis}
      </section>

      <section aria-label="Transaction trends" className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">Orders — most recent days in the database</h2>
          {trend}
        </div>
        <div className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold">Queue snapshot</h2>
          <div className="rounded-lg border border-line bg-surface p-5">
            <p className="text-sm text-muted">Review workload by decision state:</p>
            <ul role="list" className="mt-3 space-y-2 text-sm">
              {snapshot}
            </ul>
            <Link
              href="/investigations"
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              Open investigations
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </section>

      <section aria-label="Recent orders" className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Recent orders</h2>
          <Link href="/orders">
            <Button variant="secondary" size="sm">
              View all orders
            </Button>
          </Link>
        </div>
        {recentTable}
      </section>
    </div>
  );
}
