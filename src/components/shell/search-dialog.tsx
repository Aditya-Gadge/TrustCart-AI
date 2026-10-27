"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { RiskBadge, ReviewStatusBadge } from "@/components/ui/badge";
import { formatMinor, formatDateTime } from "@/lib/demo/demo-data";

/**
 * Header search entry point. Queries the SAME validated /api/orders endpoint
 * the orders page uses, so results always reflect the live database and link
 * directly to the matching order. If the API is unreachable, it degrades to
 * the labelled static demo dataset (clearly marked) instead of failing.
 *
 * Loading/idle are DERIVED at render time (query text vs latest result), so
 * the fetch effect only sets state from async callbacks.
 */

type SearchResult = {
  id: string;
  orderNumber: string;
  customerName: string;
  amount: number;
  currency: "USD" | "EUR" | "GBP";
  orderStatus: "PENDING" | "APPROVED" | "HELD_FOR_REVIEW";
  createdAt: string;
  risk: { score: number; level: "LOW" | "MEDIUM" | "HIGH" } | null;
};

type SearchResults = {
  query: string;
  items: SearchResult[];
  source: "database" | "demo";
};

const DEMO_FALLBACK: SearchResult[] = [
  {
    id: "o-01",
    orderNumber: "TC-2481",
    customerName: "Ava Meredith",
    amount: 18450,
    currency: "USD",
    orderStatus: "APPROVED",
    createdAt: "2026-10-26T14:32:00Z",
    risk: { score: 12, level: "LOW" },
  },
  {
    id: "o-02",
    orderNumber: "TC-2482",
    customerName: "Lars Östman",
    amount: 99900,
    currency: "USD",
    orderStatus: "HELD_FOR_REVIEW",
    createdAt: "2026-10-26T13:20:00Z",
    risk: { score: 78, level: "HIGH" },
  },
  {
    id: "o-06",
    orderNumber: "TC-2486",
    customerName: "Ola Nowak",
    amount: 149000,
    currency: "USD",
    orderStatus: "HELD_FOR_REVIEW",
    createdAt: "2026-10-25T21:02:00Z",
    risk: { score: 91, level: "HIGH" },
  },
];

function filterDemo(query: string): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return DEMO_FALLBACK.filter((order) =>
    `${order.orderNumber} ${order.customerName}`.toLowerCase().includes(q),
  );
}

export function SearchDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const trimmed = query.trim();
  // A request is in flight whenever the typed query is newer than the last
  // completed result set (render-time derivation, no effect setState).
  const busy = trimmed !== "" && (results === null || results.query !== trimmed);

  /** Reset + abort when the dialog is closed (event-driven). */
  function handleClose() {
    abortRef.current?.abort();
    setQuery("");
    setResults(null);
    onClose();
  }

  // Debounced database lookup; state changes only from async callbacks.
  useEffect(() => {
    if (trimmed === "") return;
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const params = new URLSearchParams({
          q: trimmed,
          pageSize: "6",
          page: "1",
        });
        const res = await fetch(`/api/orders?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { items?: SearchResult[] };
        const items = (body.items ?? []).map((item) => ({
          ...item,
          currency: item.currency as SearchResult["currency"],
          orderStatus: item.orderStatus as SearchResult["orderStatus"],
        }));
        setResults({ query: trimmed, items, source: "database" });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        // Labelled demo fallback when the API is unreachable.
        setResults({ query: trimmed, items: filterDemo(trimmed), source: "demo" });
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [trimmed]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Search orders"
      description="Find orders by number, customer, email, or country."
    >
      <div className="space-y-3">
        <input
          type="search"
          autoFocus
          aria-label="Search orders"
          placeholder="e.g. TC-3099 or a customer name…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-9 w-full rounded-md border border-line bg-background px-3 text-sm outline-none focus:border-primary/50"
        />
        {busy ? (
          <p role="status" className="text-xs text-muted">
            Searching stored orders…
          </p>
        ) : null}
        {!busy && trimmed !== "" && results !== null ? (
          results.items.length === 0 ? (
            <EmptyState
              title="No matches"
              description="No stored order matches this search. Try an order number, customer, or country."
            />
          ) : (
            <div className="space-y-2">
              {results.source === "demo" ? (
                <p role="note" className="text-xs text-warning">
                  Stored orders are unreachable — showing the labelled demo dataset.
                </p>
              ) : null}
              <ul role="list" className="divide-y divide-line">
                {results.items.map((order) => (
                  <li key={order.id}>
                    <Link
                      href={`/orders/${order.id}`}
                      onClick={handleClose}
                      className="flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm hover:bg-background"
                    >
                      <span className="min-w-0">
                        <span className="font-medium">{order.orderNumber}</span>
                        <span className="ml-2 truncate text-muted">
                          {order.customerName}
                        </span>
                        <span className="block text-xs text-muted">
                          {formatDateTime(order.createdAt)}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="tabular-nums text-xs">
                          {formatMinor(order.amount, order.currency)}
                        </span>
                        <ReviewStatusBadge status={order.orderStatus} />
                        {order.risk ? (
                          <RiskBadge band={order.risk.level} score={order.risk.score} />
                        ) : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )
        ) : null}
        {trimmed === "" ? (
          <p className="text-xs text-muted">
            Searches the live order database — results link straight to the
            matching order investigation view.
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
