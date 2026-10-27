# TrustCart AI

Explainable merchant order risk analysis, investigations, and PayPal Sandbox
payment intelligence — built for the PayPal AI Hackathon 2026.

**Current status: PayPal Sandbox payment workflow complete (Phase 5 of the
task plan).** The merchant dashboard renders over a **real PostgreSQL
database** of synthetic orders (Prisma ORM 7) with server-side pagination,
validated search/filter parameters, and an honest demo-dataset fallback when
the database is not configured or unreachable. Orders are scored by the
**deterministic, versioned risk engine** (`demo-heuristics-v1`,
`src/lib/risk/`): every displayed reason ships with the exact evidence behind
it, and every review decision (approve / hold / reset-to-pending) requires a
confirmed reason, is validated against a server-side transition matrix with
optimistic concurrency, and writes a Review + fresh engine snapshot + audit
event in one transaction. The **AI copilot** (`/copilot`, Gemini via the
server-only `@google/genai` SDK, default model `gemini-3.8-flash`) answers
through fixed read-only tools over the database, cites only evidence it
actually retrieved, and degrades to live stored data when no
`GEMINI_API_KEY` is configured, quota is exhausted, or the provider is
unreachable. **APPROVED orders can be paid through PayPal Sandbox** (Orders
API v2, server-side capture with full verification, idempotent retries,
optional verified webhooks — see the PayPal section below); the payment
amount is always computed server-side and `VERIFIED` is written only after
server confirmation. Nothing here connects to live payment services (the
PayPal config parser refuses any non-Sandbox host) and no real credentials
exist in this repo.

## Prerequisites

- Node.js 24+ and npm 11+
- Docker Desktop (for the local PostgreSQL container) — optional: without it
  the app still boots and the orders page shows clearly-labelled demo data.

## Getting started

```sh
npm install
docker compose up -d          # local PostgreSQL 16 on host port 54329
npm run db:generate           # generate the Prisma client into src/generated
npm run db:migrate            # apply migrations (creates prisma/migrations)
npm run db:seed -- --count=800  # 500–2,000 deterministic synthetic orders
npm run dev
```

Open http://localhost:3000 — the Overview page serves live KPIs and a 14-day
trend from `GET /api/stats` (labelled demo fallback without a database); the
**Orders** page serves live, paginated database rows with search, risk-band
and status filters, and sorting; every order opens an **investigation page**
(`/orders/<id>`) with the full risk breakdown and evidence, review actions
(confirm dialog + required reason), review history, and the audit timeline.
The seed refuses to overwrite an existing dataset unless `--replace` is passed
(destructive action, local dev database only).

## PayPal Sandbox payments

APPROVED orders grow a **Collect payment via PayPal Sandbox** panel on their
investigation page. Money facts are server-side only: the buttons ask
`POST /api/orders/:id/payments` to create the PayPal order (amount/currency
computed from the database), relay only the PayPal order reference after
approval, and `POST /api/orders/:id/payments/capture` captures and verifies
the result server-side (provider order id, capture status, amount, currency,
and association with the app order) before `VERIFIED` is persisted. Capture
is idempotent — retries and double submissions never duplicate records — and
cancellation, declines, mismatches, and provider timeouts have explicit
states and messages. Optional webhooks (`PAYPAL_WEBHOOK_ID`) are
signature-verified before any state change.

**Enabling a real Sandbox checkout (manual QA — not exercised in this repo,
no credentials exist here):**

1. Create a Sandbox app at <https://developer.paypal.com/dashboard/applications>
   (Business account comes with the developer sandbox).
2. Put the Sandbox **client id** and **secret** in `.env`
   (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`). Only the Sandbox host is
   accepted; a live host is refused by validation.
3. Optional: create a webhook in the developer dashboard pointing at your
   local tunnel (e.g. `https://<tunnel>/api/payments/webhooks/paypal`) for
   `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`,
   `PAYMENT.CAPTURE.DENIED`, and set `PAYPAL_WEBHOOK_ID`.
4. `npm run dev`, open an **APPROVED** order's investigation page, pay with a
   Sandbox buyer account, and confirm the payment shows `VERIFIED` with a
   capture id in the payment history and audit timeline.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint (flat config) |
| `npm run typecheck` | TypeScript `--noEmit` strict check |
| `npm run test` | Vitest (unit + live-database integration; integration skips without `DATABASE_URL`) |
| `npm run db:generate` | Generate the Prisma client (`src/generated/prisma`) |
| `npm run db:migrate` | Apply migrations in development (`prisma migrate dev`) |
| `npm run db:deploy` | Apply migrations without prompts (`prisma migrate deploy`) |
| `npm run db:seed -- --count=N` | Seed 500–2,000 synthetic orders (add `--replace` to delete existing rows first) |

## Project structure

```
src/app/            App Router pages (/, /orders, /orders/[id], /investigations, /copilot, /settings) + API routes
src/app/api/orders/ GET /api/orders — validated, paginated order search (400/503 semantics)
src/app/api/orders/[id]/review/  POST review decision (Zod body, transition matrix, 409/422 semantics)
src/app/api/orders/[id]/payments/  POST create PayPal order + .../capture — server-side capture & verification
src/app/api/payments/webhooks/paypal/  POST PayPal webhooks (signature-verified, idempotent)
src/lib/payments/   Server-only PayPal Sandbox integration, payment flow, money helpers
src/components/payments/  PayPal Sandbox checkout buttons (client id only)
src/app/api/stats/  GET /api/stats — dashboard aggregates from stored engine snapshots
src/app/api/copilot/chat/  POST copilot chat — rate limit, Zod body, NDJSON event stream
src/lib/ai/         Server-only Gemini integration, read-only copilot tools, orchestrator, Zod contracts
src/components/copilot/  Copilot chat UI (streaming status, retry, stored-data fallback)
src/lib/risk/       Deterministic risk engine (pure functions) + versioned rules catalogue
src/lib/review/     Review transition matrix + labels (shared server/client)
src/components/ui/  Reusable primitives (buttons, badges, tables, dialogs, states)
src/components/shell/  Dashboard shell (collapsible sidebar, header, search, profile)
src/components/orders/ Order explorer + risk breakdown + review actions
src/components/dashboard/  DB-backed overview dashboard (stats + labelled fallback)
src/components/investigations/  Review queue (held + high-risk pending)
src/components/demo/   Demo-specific interactive compositions (fallback only)
src/db/             Prisma client singleton + data access (orders, reviews, investigations, stats)
src/lib/validation/ Shared Zod schemas (order query parameters, review action payload)
src/lib/env.ts      Environment validation (DATABASE_URL)
src/lib/demo/       Phase 1 demo dataset (fallback only, clearly labelled)
src/seed/           Deterministic synthetic order generator (pure functions, real engine)
prisma/             schema.prisma + migrations + guarded seed script
tests/              Vitest unit suites + live-database integration suite
docs/               Architecture + phase plan
```

## Data & demo data boundary

- The **Orders** page and the investigation pages read from PostgreSQL via
  validated API routes / server components. If the database is unreachable the
  APIs return `503 database_unreachable` and the UI shows an explicit error
  state with retry; if no `DATABASE_URL` is configured at all
  (`503 database_unconfigured`), the dashboard and queue fall back to the
  Phase 1 demo dataset behind a visible **Demo fallback** banner. The app
  never presents static demo rows as live query results.
- The Settings page remains a Phase 1 synthetic placeholder (clearly labelled
  in the UI).
- The **AI copilot** is explicitly labelled per answer: `STORED_DATA` answers
  are grounded in rows the read-only tools fetched from the database during
  that request, and every citation (order id + risk reason codes) is verified
  server-side — hallucinated order references are dropped and ungrounded
  answers are downgraded to clearly-labelled explanatory AI text. It has no
  write path (no write tool exists), cannot run SQL or shell commands, and
  shows live stored high-risk orders instead of AI text when Gemini is
  unconfigured, out of quota, or unreachable. The in-memory rate limiter
  (10 questions/min/IP) works within one server instance only. **No live
  Gemini call has been verified yet** — no API key exists in this repo;
  model behaviour is covered by mocked-transport tests and must be
  re-verified manually once a key is configured.
- Risk scores are **demo heuristics, not validated fraud predictions** — every
  UI surface that shows a score says so. The known synthetic fraud labels
  (`EvalLabel`) are never read by scoring code (enforced by a source-scan
  test).
- Review decisions are consequential: confirmation dialog + written reason
  (re-validated server-side), server-authoritative transition matrix, and
  optimistic concurrency (`expectedUpdatedAt` → 409 instead of a silent
  overwrite). The reviewer identity is the server-fixed demo actor
  `demo-merchant`; real authentication is out of hackathon scope (decision
  D-002).
- The seed writes **synthetic data only** (`@demo.example` addresses, invented
  names) and **never creates Payment rows** — payment records can only come
  from the server-side PayPal Sandbox flow (`src/lib/payments/`), and
  `VERIFIED` is written only after server-side capture verification.
- `EvalLabel` is evaluation-only metadata (the known synthetic class of each
  seeded order). Risk-scoring code must never read it.

## Environment variables

`.env.example` lists the variables used so far (PostgreSQL `DATABASE_URL`;
`GEMINI_API_KEY` / `GEMINI_MODEL` for the copilot since Phase 4;
`PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` / `PAYPAL_WEBHOOK_ID` for the
Sandbox payment flow since Phase 5) with **placeholders
only**. Copy it to `.env` for local development — `.env` is gitignored.

- Keep every real credential out of git, logs, screenshots, and client code.
- `GEMINI_API_KEY` and the PayPal **secret** are read server-side only (the
  copilot and payment modules are marked `server-only`); without them the
  app boots and the respective features degrade to labelled states. The
  PayPal **client id** is public by design and is the only credential the
  browser ever sees.
- `.gitignore` excludes `.env*` but intentionally includes `.env.example`.
- The database URL is validated at startup (`src/lib/env.ts`); the app boots
  without one and degrades to the labelled demo fallback.

All monetary values use **integer minor units** with an explicit currency,
matching the discipline later applied by the risk engine and PayPal flows.

## Accessibility & UX commitments

- Keyboard-navigable sidebar, dialogs (native `<dialog>`), and menus; skip-to-content link; visible focus states.
- Responsive: desktop sidebar collapses to an icon rail (24px transition, content reflows without distortion); tablet/mobile uses a slide-over drawer.
- Designed loading (skeletons), empty, and error states are part of the shared component system.
- Light theme only in Phase 1 (scoped-out: dark theme).

## Roadmap

See `docs/architecture.md` and `docs/implementation-phases.md` for the phased
plan, acceptance criteria, and open decisions.
