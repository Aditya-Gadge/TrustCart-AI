"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEMO_ORDERS,
  RISK_BAND_LABEL,
  REVIEW_STATUS_LABEL,
  formatDateTime,
  formatMinor,
  type DemoOrder,
} from "@/lib/demo/demo-data";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar, SearchInput, SelectInput } from "@/components/ui/inputs";
import { Button } from "@/components/ui/button";
import { Badge, RiskBadge, ReviewStatusBadge } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui/error-state";

type StatusFilter = "ALL" | "PENDING" | "APPROVED" | "HELD_FOR_REVIEW";
type BandFilter = "ALL" | "LOW" | "MEDIUM" | "HIGH";
type SortFilter = "newest" | "oldest" | "risk_high" | "risk_low" | "amount_high" | "amount_low";
type RiskKey = "LOW" | "MEDIUM" | "HIGH";
type CurrencyKey = "USD" | "EUR" | "GBP";

type OrderView = {
  id: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  shippingCountry: string;
  amount: number;
  currency: string;
  itemCount: number;
  orderStatus: StatusFilter;
  createdAt: string;
  risk: { score: number; level: RiskKey } | null;
};

type DbState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; items: OrderView[]; total: number; pageCount: number };

const PAGE_SIZE = 12;

const tableColumns: Column<OrderView>[] = [
  {
    key: "number",
    header: "Order",
    render: (r) => (
      <Link href={`/orders/${r.id}`} className="font-medium hover:underline">
        {r.orderNumber}
      </Link>
    ),
  },
  {
    key: "customer",
    header: "Customer",
    render: (r) => (
      <span className="min-w-0">
        <span className="block truncate">{r.customerName}</span>
        <span className="block truncate text-xs text-muted">{r.customerEmail}</span>
      </span>
    ),
  },
  { key: "country", header: "Country", render: (r) => r.shippingCountry },
  { key: "items", header: "Items", numeric: true, render: (r) => r.itemCount },
  {
    key: "total",
    header: "Total",
    numeric: true,
    render: (r) => formatMinor(r.amount, (r.currency as CurrencyKey) ?? "USD"),
  },
  {
    key: "risk",
    header: "Risk",
    render: (r) =>
      r.risk ? (
        <RiskBadge score={r.risk.score} band={r.risk.level} />
      ) : (
        <Badge tone="neutral">Not scored</Badge>
      ),
  },
  {
    key: "status",
    header: "Review status",
    render: (r) => <ReviewStatusBadge status={r.orderStatus as Exclude<StatusFilter, "ALL">} />,
  },
  {
    key: "placedAt",
    header: "Placed",
    render: (r) => (
      <span className="whitespace-nowrap text-xs text-muted">
        {formatDateTime(new Date(r.createdAt).toISOString())}
      </span>
    ),
  },
];

const fallbackColumns: Column<DemoOrder>[] = [
  {
    key: "number",
    header: "Order",
    render: (o) => <span className="font-medium">{o.number}</span>,
  },
  {
    key: "customer",
    header: "Customer",
    render: (o) => (
      <span className="min-w-0">
        <span className="block truncate">{o.customer}</span>
        <span className="block truncate text-xs text-muted">{o.country}</span>
      </span>
    ),
  },
  { key: "items", header: "Items", numeric: true, render: (o) => o.itemCount },
  {
    key: "total",
    header: "Total",
    numeric: true,
    render: (o) => formatMinor(o.totalMinor, o.currency),
  },
  { key: "risk", header: "Risk", render: (o) => <RiskBadge score={o.riskScore} band={o.riskBand} /> },
  {
    key: "status",
    header: "Review status",
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

/**
 * Order exploration over the Phase 2 database-backed API with validated,
 * server-side pagination. When the database is not configured or cannot
 * be reached, the component falls back to the Phase 1 demo dataset and
 * says so clearly — it never presents demo data as live results.
 */
export function OrderExplorer() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [band, setBand] = useState<BandFilter>("ALL");
  const [sort, setSort] = useState<SortFilter>("newest");
  const [page, setPage] = useState(1);

  const [db, setDb] = useState<DbState>({ kind: "loading" });
  const [fallbackDemo, setFallbackDemo] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(
    async (opts: {
      page: number;
      q: string;
      status: StatusFilter;
      band: BandFilter;
      sort: SortFilter;
    }) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setDb({ kind: "loading" });
      try {
        const params = new URLSearchParams({
          page: String(opts.page),
          pageSize: String(PAGE_SIZE),
          status: opts.status,
          band: opts.band,
          sort: opts.sort,
        });
        if (opts.q.trim() !== "") params.set("q", opts.q.trim());

        const res = await fetch(`/api/orders?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          // Database not configured at all: fall back to the Phase 1 demo
          // dataset behind a clear banner instead of an alarming error.
          if (body?.error === "database_unconfigured") {
            setFallbackDemo(true);
            return;
          }
          throw new Error(
            body?.error === "database_unreachable"
              ? "Database is unreachable"
              : `Unexpected API response (${res.status})`,
          );
        }
        const data = (await res.json()) as {
          items: OrderView[];
          total: number;
          page: number;
          pageCount: number;
        };
        setFallbackDemo(false);
        setDb({
          kind: "ready",
          items: data.items,
          total: data.total,
          pageCount: data.pageCount,
        });
        if (data.total > 0 && data.items.length === 0 && opts.page > 1) {
          setPage(1);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDb({
          kind: "error",
          message: error instanceof Error ? error.message : "The order service is unavailable.",
        });
      }
    },
    [],
  );

  // Debounced search; immediate refetch for the rest of the controls.
  useEffect(() => {
    const delay = query === "" ? 0 : 280;
    const timer = setTimeout(() => {
      void fetchData({ page, q: query, status, band, sort });
    }, delay);
    return () => clearTimeout(timer);
  }, [fetchData, page, query, status, band, sort]);

  const clearFilters = useCallback(() => {
    setQuery("");
    setStatus("ALL");
    setBand("ALL");
    setSort("newest");
    setPage(1);
  }, []);

  if (fallbackDemo) {
    return (
      <div>
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          <Badge tone="warning">Demo fallback</Badge>
          <span className="max-w-3xl flex-1 leading-5">
            The database is not configured or unreachable, so the Phase 1 demo
            dataset is displayed. These are static rows, not live query
            results.
          </span>
          <Button variant="secondary" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setFallbackDemo(false);
              void fetchData({ page, q: query, status, band, sort });
            }}
          >
            Retry database
          </Button>
        </div>
        <DataTable
          columns={fallbackColumns}
          rows={DEMO_ORDERS}
          caption="Demo dataset fallback — 24 static synthetic orders"
          empty={{
            title: "No demo order matches",
            description: "Demo rows are static; clear filters to see the full set.",
          }}
        />
      </div>
    );
  }

  return (
    <div>
      <FilterBar>
        <SearchInput
          label="Search"
          placeholder="Number, customer, email, country…"
          value={query}
          onValueChange={(v) => {
            setPage(1);
            setQuery(v);
          }}
        />
        <SelectInput
          label="Review status"
          value={status}
          onValueChange={(v) => {
            setPage(1);
            setStatus(v as StatusFilter);
          }}
          options={[
            { value: "ALL", label: "All statuses" },
            ...(Object.entries(REVIEW_STATUS_LABEL) as [Exclude<StatusFilter, "ALL">, string][]).map(
              ([value, label]) => ({ value, label }),
            ),
          ]}
        />
        <SelectInput
          label="Risk band"
          value={band}
          onValueChange={(v) => {
            setPage(1);
            setBand(v as BandFilter);
          }}
          options={[
            { value: "ALL", label: "All bands" },
            ...(Object.entries(RISK_BAND_LABEL) as [Exclude<BandFilter, "ALL">, string][]).map(
              ([value, label]) => ({ value, label }),
            ),
          ]}
        />
        <SelectInput
          label="Sort"
          value={sort}
          onValueChange={(v) => {
            setPage(1);
            setSort(v as SortFilter);
          }}
          options={[
            { value: "newest", label: "Newest first" },
            { value: "oldest", label: "Oldest first" },
            { value: "risk_high", label: "Risk: high → low" },
            { value: "risk_low", label: "Risk: low → high" },
            { value: "amount_high", label: "Amount: high → low" },
            { value: "amount_low", label: "Amount: low → high" },
          ]}
        />
      </FilterBar>

      {db.kind === "loading" ? (
        <DataTable<OrderView>
          columns={tableColumns}
          rows={[]}
          caption="Orders (loading)"
          loadingRows={8}
        />
      ) : db.kind === "error" ? (
        <div className="space-y-3">
          <ErrorState
            description={`${db.message}. The order list could not be loaded.`}
            retry={{ label: "Retry database", onRetry: () => void fetchData({ page, q: query, status, band, sort }) }}
          />
          <div className="text-center">
            <Button variant="secondary" size="sm" onClick={() => setFallbackDemo(true)}>
              Show demo data instead
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mb-3 text-xs text-muted tabular-nums" aria-live="polite">
            {db.total} order{db.total === 1 ? "" : "s"} match · {db.items.length} shown on page {page} of {db.pageCount}
          </p>
          <DataTable
            columns={tableColumns}
            rows={db.items}
            caption="Database-backed orders with risk assessment and review status"
            empty={{
              title: db.total > 0 ? "No orders on this page" : "No orders in the database yet",
              description:
                db.total > 0
                  ? "Reduce filters or go back to page 1."
                  : "Start the local database and seed it: docker compose up -d, then npm run db:migrate, then npx prisma db seed.",
              action: (
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  Clear all filters
                </Button>
              ),
            }}
          />
          {db.pageCount > 1 ? (
            <nav aria-label="Order list pagination" className="mt-4 flex items-center justify-between">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <span className="text-xs tabular-nums text-muted">
                Page {page} of {db.pageCount}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= db.pageCount}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
