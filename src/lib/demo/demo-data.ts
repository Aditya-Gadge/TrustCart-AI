/*
 * ── DEMO DATA MODULE ──────────────────────────────────────────────────────
 * Synthetic fallback dataset. NOTHING here is production data. These rows
 * are only rendered in labelled demo-fallback states (e.g. database
 * unreachable); the live app is database-backed. All money values are
 * integer minor units with an explicit currency — the same discipline the
 * deterministic risk engine and the PayPal integration use.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { levelForScore } from "@/lib/risk/engine";

export type ReviewStatus = "PENDING" | "APPROVED" | "HELD_FOR_REVIEW";
export type RiskBand = "LOW" | "MEDIUM" | "HIGH";
export type Currency = "USD" | "EUR" | "GBP";

export type DemoOrder = {
  id: string;
  number: string;
  customer: string;
  email: string;
  country: string;
  itemCount: number;
  totalMinor: number;
  currency: Currency;
  riskScore: number; // 0–100 (demo heuristic)
  riskBand: RiskBand; // ALWAYS derived from riskScore via the engine's levelForScore
  reviewStatus: ReviewStatus;
  placedAt: string; // ISO date-time
};

/** Display-only: minor units → localized currency string for demo tables. */
export function formatMinor(amountMinor: number, currency: Currency): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  HELD_FOR_REVIEW: "Held for review",
};

export const RISK_BAND_LABEL: Record<RiskBand, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

type DemoOrderInput = Omit<DemoOrder, "riskBand">;

const orderInputs: DemoOrderInput[] = [
  { id: "o-01", number: "TC-2481", customer: "Ava Meredith", email: "ava.m92@demo.example", country: "United States", itemCount: 3, totalMinor: 18450, currency: "USD", riskScore: 12, reviewStatus: "APPROVED", placedAt: "2026-10-26T14:32:00Z" },
  { id: "o-02", number: "TC-2482", customer: "Lars Östman", email: "lars.o@demo.example", country: "Denmark", itemCount: 1, totalMinor: 99900, currency: "USD", riskScore: 78, reviewStatus: "HELD_FOR_REVIEW", placedAt: "2026-10-26T13:20:00Z" },
  { id: "o-03", number: "TC-2483", customer: "Priya Raghavan", email: "priya.r@demo.example", country: "India", itemCount: 7, totalMinor: 4210, currency: "USD", riskScore: 8, reviewStatus: "APPROVED", placedAt: "2026-10-26T11:05:00Z" },
  { id: "o-04", number: "TC-2484", customer: "Tomás Ferreira", email: "tomas.f@demo.example", country: "Brazil", itemCount: 2, totalMinor: 27300, currency: "USD", riskScore: 31, reviewStatus: "PENDING", placedAt: "2026-10-26T09:47:00Z" },
  { id: "o-05", number: "TC-2485", customer: "Mei Tanaka", email: "mei.t@demo.example", country: "Japan", itemCount: 4, totalMinor: 51220, currency: "USD", riskScore: 22, reviewStatus: "PENDING", placedAt: "2026-10-25T22:18:00Z" },
  { id: "o-06", number: "TC-2486", customer: "Ola Nowak", email: "ola.n@demo.example", country: "Poland", itemCount: 1, totalMinor: 149000, currency: "USD", riskScore: 91, reviewStatus: "HELD_FOR_REVIEW", placedAt: "2026-10-25T21:02:00Z" },
  { id: "o-07", number: "TC-2487", customer: "Jamal Okafor", email: "jamal.o@demo.example", country: "Nigeria", itemCount: 5, totalMinor: 9880, currency: "USD", riskScore: 18, reviewStatus: "APPROVED", placedAt: "2026-10-25T17:44:00Z" },
  { id: "o-08", number: "TC-2488", customer: "Elena Sorina", email: "elena.s@demo.example", country: "Romania", itemCount: 2, totalMinor: 33110, currency: "USD", riskScore: 42, reviewStatus: "PENDING", placedAt: "2026-10-25T15:30:00Z" },
  { id: "o-09", number: "TC-2489", customer: "Noah Bennett", email: "noah.b@demo.example", country: "United Kingdom", itemCount: 9, totalMinor: 156300, currency: "USD", riskScore: 85, reviewStatus: "HELD_FOR_REVIEW", placedAt: "2026-10-25T04:11:00Z" },
  { id: "o-10", number: "TC-2490", customer: "Sofía Márquez", email: "sofia.m@demo.example", country: "Mexico", itemCount: 3, totalMinor: 7420, currency: "USD", riskScore: 15, reviewStatus: "APPROVED", placedAt: "2026-10-24T19:56:00Z" },
  { id: "o-11", number: "TC-2491", customer: "Henrik Søborg", email: "henrik.s@demo.example", country: "Norway", itemCount: 2, totalMinor: 22800, currency: "USD", riskScore: 27, reviewStatus: "PENDING", placedAt: "2026-10-24T16:40:00Z" },
  { id: "o-12", number: "TC-2492", customer: "Issa Traoré", email: "issa.t@demo.example", country: "France", itemCount: 6, totalMinor: 88450, currency: "USD", riskScore: 66, reviewStatus: "PENDING", placedAt: "2026-10-24T12:09:00Z" },
  { id: "o-13", number: "TC-2493", customer: "Kate Whelan", email: "kate.w@demo.example", country: "Ireland", itemCount: 1, totalMinor: 6100, currency: "USD", riskScore: 5, reviewStatus: "APPROVED", placedAt: "2026-10-23T20:15:00Z" },
  { id: "o-14", number: "TC-2494", customer: "Diego Herrera", email: "diego.h@demo.example", country: "Spain", itemCount: 4, totalMinor: 35770, currency: "USD", riskScore: 38, reviewStatus: "HELD_FOR_REVIEW", placedAt: "2026-10-23T18:27:00Z" },
  { id: "o-15", number: "TC-2495", customer: "Amina Diallo", email: "amina.d@demo.example", country: "Canada", itemCount: 2, totalMinor: 19960, currency: "USD", riskScore: 11, reviewStatus: "APPROVED", placedAt: "2026-10-23T13:52:00Z" },
  { id: "o-16", number: "TC-2496", customer: "Yusuf Kamal", email: "yusuf.k@demo.example", country: "Turkey", itemCount: 8, totalMinor: 112300, currency: "USD", riskScore: 88, reviewStatus: "PENDING", placedAt: "2026-10-23T02:33:00Z" },
  { id: "o-17", number: "TC-2497", customer: "Anna Kowalski", email: "anna.k@demo.example", country: "Germany", itemCount: 3, totalMinor: 16790, currency: "USD", riskScore: 9, reviewStatus: "APPROVED", placedAt: "2026-10-22T21:14:00Z" },
  { id: "o-18", number: "TC-2498", customer: "Felix Braun", email: "felix.b@demo.example", country: "Germany", itemCount: 2, totalMinor: 44880, currency: "USD", riskScore: 47, reviewStatus: "PENDING", placedAt: "2026-10-22T19:38:00Z" },
  { id: "o-19", number: "TC-2499", customer: "Grace Lim", email: "grace.l@demo.example", country: "Singapore", itemCount: 5, totalMinor: 29340, currency: "USD", riskScore: 17, reviewStatus: "APPROVED", placedAt: "2026-10-22T14:05:00Z" },
  { id: "o-20", number: "TC-2500", customer: "Milo Jansen", email: "milo.j@demo.example", country: "Netherlands", itemCount: 1, totalMinor: 98500, currency: "USD", riskScore: 74, reviewStatus: "HELD_FOR_REVIEW", placedAt: "2026-10-22T03:48:00Z" },
  { id: "o-21", number: "TC-2501", customer: "Ruby Castellano", email: "ruby.c@demo.example", country: "Argentina", itemCount: 3, totalMinor: 12980, currency: "USD", riskScore: 21, reviewStatus: "PENDING", placedAt: "2026-10-21T18:52:00Z" },
  { id: "o-22", number: "TC-2502", customer: "Ethan Walsh", email: "ethan.w@demo.example", country: "New Zealand", itemCount: 4, totalMinor: 51110, currency: "USD", riskScore: 14, reviewStatus: "APPROVED", placedAt: "2026-10-21T10:26:00Z" },
  { id: "o-23", number: "TC-2503", customer: "Nadia Petrov", email: "nadia.p@demo.example", country: "South Africa", itemCount: 6, totalMinor: 67999, currency: "USD", riskScore: 58, reviewStatus: "PENDING", placedAt: "2026-10-21T05:19:00Z" },
  { id: "o-24", number: "TC-2504", customer: "Luca Bianchi", email: "luca.b@demo.example", country: "Italy", itemCount: 2, totalMinor: 33620, currency: "USD", riskScore: 33, reviewStatus: "PENDING", placedAt: "2026-10-20T19:41:00Z" },
];

/** Bands are DERIVED with the engine's mapping — they can never contradict a
 * database-backed row for the same score (Phase 6 regression fix). */
const orders: DemoOrder[] = orderInputs.map((order) => ({
  ...order,
  riskBand: levelForScore(order.riskScore),
}));

export const DEMO_ORDERS: readonly DemoOrder[] = orders;

/** Sorted newest-first — always derive, never mutate the base array. */
export function latestOrders(count: number): DemoOrder[] {
  return [...orders]
    .sort((a, b) => b.placedAt.localeCompare(a.placedAt))
    .slice(0, count);
}

export type DemoKpi = {
  id: string;
  label: string;
  value: string;
  delta: { text: string; positive: boolean } | null;
  hint: string;
};

export const DEMO_KPIS: readonly DemoKpi[] = [
  {
    id: "kpi-orders",
    label: "Orders (7 days)",
    value: "124",
    delta: { text: "+8 vs prior week", positive: true },
    hint: "All orders across storefront channels",
  },
  {
    id: "kpi-flagged",
    label: "Flagged for review",
    value: "9",
    delta: { text: "+2 vs prior week", positive: false },
    hint: "Orders currently held or pending with elevated risk",
  },
  {
    id: "kpi-approval",
    label: "Approval rate",
    value: "84%",
    delta: { text: "+3 pts vs prior week", positive: true },
    hint: "Approvals over completed review decisions",
  },
  {
    id: "kpi-net-sales",
    label: "Net sales (7 days)",
    value: formatMinor(4826100, "USD"),
    delta: { text: "+11% vs prior week", positive: true },
    hint: "Approved order totals",
  },
];

export type TrendPoint = { label: string; orders: number; flagged: number };

export const DEMO_TREND: readonly TrendPoint[] = [
  { label: "Oct 13", orders: 11, flagged: 1 },
  { label: "Oct 14", orders: 14, flagged: 2 },
  { label: "Oct 15", orders: 12, flagged: 1 },
  { label: "Oct 16", orders: 18, flagged: 3 },
  { label: "Oct 17", orders: 21, flagged: 2 },
  { label: "Oct 18", orders: 17, flagged: 1 },
  { label: "Oct 19", orders: 23, flagged: 4 },
  { label: "Oct 20", orders: 19, flagged: 2 },
  { label: "Oct 21", orders: 16, flagged: 1 },
  { label: "Oct 22", orders: 20, flagged: 3 },
  { label: "Oct 23", orders: 24, flagged: 2 },
  { label: "Oct 24", orders: 22, flagged: 2 },
  { label: "Oct 25", orders: 27, flagged: 5 },
  { label: "Oct 26", orders: 25, flagged: 3 },
];

export type DemoInvestigation = {
  orderId: string;
  number: string;
  customer: string;
  country: string;
  totalMinor: number;
  currency: Currency;
  riskScore: number;
  riskBand: RiskBand;
  status: ReviewStatus;
  waitingSince: string;
  summary: string; // labelled fallback copy — live rows show engine reasons
};

const investigations: DemoInvestigation[] = orders
  .filter(
    (o) =>
      o.reviewStatus === "HELD_FOR_REVIEW" ||
      (o.reviewStatus === "PENDING" && o.riskBand === "HIGH"),
  )
  .sort((a, b) => b.riskScore - a.riskScore)
  .map((o) => ({
    orderId: o.id,
    number: o.number,
    customer: o.customer,
    country: o.country,
    totalMinor: o.totalMinor,
    currency: o.currency,
    riskScore: o.riskScore,
    riskBand: o.riskBand,
    status: o.reviewStatus,
    waitingSince: o.placedAt,
    summary:
      "Demo fallback row — database-backed orders show the full engine reasons and evidence.",
  }));

export const DEMO_INVESTIGATIONS: readonly DemoInvestigation[] = investigations;

/** Annotated demo questions for the Phase 4 copilot placeholder panel. */
export const DEMO_COPILOT_EXAMPLES: readonly string[] = [
  "Why is order TC-2500 flagged?",
  "Which countries show the highest held orders this week?",
  "Summarize risk factors for my pending high-value orders.",
  "What changed in today's approval rate compared to last week?",
];

export const DEMO_MERCHANT = {
  name: "Northwind Village Goods",
  merchantLabel: "DV-04-7332",
  regionLabel: "United States · Pacific",
  currencyLabel: "USD",
  notes: [
    { label: "Environment: local development (synthetic data only)", active: true },
    { label: "Risk engine: deterministic demo heuristics v1", active: true },
    { label: "AI copilot: stored-data grounding (Gemini optional)", active: true },
    { label: "PayPal Sandbox checkout: server-verified payment flow", active: true },
  ],
} as const;
