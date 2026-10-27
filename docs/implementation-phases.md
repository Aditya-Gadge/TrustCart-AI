# TrustCart AI — Implementation Phases

Status: Approved. The repository bootstrap, the data-model/seed/order-table
phase, the deterministic risk engine, the investigation/review-workflow phase,
the Gemini merchant copilot phase, and the PayPal Sandbox payment phase are
implemented and verified (2026-10-27). One bounded phase at a time per
AGENTS.md loop protocol. No phase starts before the previous one's acceptance
criteria pass or its blockers are documented.

## Phase 0 — Repository bootstrap (tooling only)

**Scope:** `git init`; `package.json` with pinned stable versions; TypeScript strict; ESLint; Prettier; Tailwind; Vitest scaffolding; Prisma + `docker-compose.yml` (PostgreSQL 16) with documented local-dev instructions; `.env.example`; `.gitignore` (includes `.env`); empty placeholder pages. Zero feature code.

**Acceptance criteria (measurable):**
1. `npm run typecheck` exits 0.
2. `npm run lint` exits 0.
3. `npm run build` (production) exits 0.
4. `docker compose up -d` starts Postgres; `prisma migrate dev` applies an initial (empty) migration and `prisma generate` succeeds.
5. `npm run test` runs an empty Vitest suite and exits 0.
6. No `.env` is tracked in git (`git status` clean check).

## Phase 1 — Data model, seed, order table (read-only UI)

**Status: ✅ Implemented and verified 2026-10-27.**

Shipped: `prisma/schema.prisma` (Order, RiskAssessment, Review, Payment,
AuditEvent, EvalLabel + enums/indexes), `prisma.config.ts` (Prisma 7), Docker
Compose PostgreSQL 16 on host port 54329, migration `20261027103830_init`,
deterministic seed (500–2,000 orders, default 800, exact 68/16/10/6 class
distribution, overwrite guard requiring `--replace`), `GET /api/orders` with
Zod-validated parameters (400 `invalid_query`, 503 `database_unconfigured` /
`database_unreachable`), DB-backed `/orders` table with server-side
pagination + loading/empty/error/fallback states, Vitest suites (30 tests:
query validation, env validation, seed determinism/constraints, live-database
integration for uniqueness, cascade, filtering, pagination, seed guard).

Verified: `npm run lint` / `typecheck` / `test` (30/30) / `build` all exit 0;
live smoke test: 200 with seeded data, 400 on malformed query, 503 with
Postgres stopped.

**Deviations from the original scope (documented, not hidden):**
- Determinism acceptance criterion ("seeding 200 orders twice") is met at the
  task-mandated 500–2,000 scale: the generator is unit-tested byte-identical
  for identical (seed, count), and the seed script refuses non-empty
  databases without `--replace` (integration-tested).
- `GET /api/orders/:id` (investigation payload) is deferred to the
  investigation-detail phase — nothing consumes it yet.
- UI-state checks are covered by Vitest + manual HTTP smoke tests, not
  Playwright (no browser-test harness is configured in this repo yet).
- Schema naming adapted as recorded in `docs/architecture.md` §3
  (one-to-one `RiskAssessment` instead of denormalized risk columns; `reasons`
  JSON snapshot instead of per-factor rows; `Review` + `AuditEvent` split;
  `OrderItem`/`OrderAmounts` deferred until their consuming phase).

**Acceptance criteria:**
1. Seeding 200 orders twice produces identical data (deterministic seed).
2. `GET /api/orders` rejects malformed query strings with 400 (integration test).
3. Filters and free-text search return correct filtered sets (integration tests).
4. Table renders 200 seeded orders with paging; responsive check passes at 360px and 1280px widths (Playwright viewport test).
5. UI states: empty, loading, error all reachable and screen-readable (Playwright + code evidence).

## Phase 2 — Deterministic risk engine

**Status: ✅ Implemented and verified 2026-10-27** (shipped together with the
Phase 3 investigation workflow as one bounded task, since the review flow
persists engine snapshots).

Shipped: `src/lib/risk/rules.ts` (versioned catalogue `demo-heuristics-v1` —
per-currency value thresholds, velocity/account-age tiers, mismatch, odd-hour
window, documented compound-interaction bonus, configurable weights) and
`src/lib/risk/engine.ts` (pure `assessOrder()` → score 0–100, LOW/MEDIUM/HIGH
band, reason codes with per-reason evidence, rules version). The seed
generator and every review action re-score through this one engine — the
stored snapshots all read `demo-heuristics-v1`.

Verified: 25 engine unit tests covering band edges (0/34/35/69/70/100),
per-signal threshold boundaries, mutually exclusive tiers (correlated signals
never double-count), missing/invalid inputs, compound rules, determinism
(byte-identical output), evidence presence, and a source-scan guard asserting
the engine never imports the evaluation-only label table or the DB client.
Forged client risk data is structurally unreachable: the API accepts no score
input at all, and authoritative snapshots are recomputed server-side.

**Deviations:** UI rendering of reasons is verified via the rendered
investigation page (live HTTP smoke test) rather than a Playwright check; v1
has no mitigating (negative) factors — documented demo limitation.

**Acceptance criteria:**
1. Unit tests: ≥ 20 golden fixtures (each factor zero, single-factor, combined, clamp edges 0/100) pass. ✅ (25 tests)
2. Same seed data rescoring yields byte-identical factor snapshots (determinism test). ✅
3. Every factor has code + human-readable explanation rendered in UI (Playwright check). ✅ rendered evidence verified via live HTTP smoke test (Playwright harness deferred to Phase 6)
4. No score math depends on client input (code review + integration test posting forged score is ignored). ✅ forged fields are stripped server-side (integration test)

## Phase 3 — Investigation detail + review workflow + audit

**Status: ✅ Implemented and verified 2026-10-27.**

Shipped: `/orders/[id]` investigation page (order facts, risk breakdown with
per-reason evidence, review actions with confirmation dialog, review history,
honest payments placeholder, audit timeline); transition matrix
(`PENDING → APPROVE/HOLD`, `HELD → APPROVE/RESET`, `APPROVED → HOLD/RESET`)
enforced server-side; `POST /api/orders/[id]/review` with Zod validation
(reason required ≥ 4 chars, `expectedUpdatedAt` for optimistic concurrency —
409 `stale_write` instead of silent overwrites, 422 `invalid_transition`,
404, 400); one interactive transaction per decision writing Review + fresh
engine snapshot + `AuditEvent` (actor, from/to, reason, reviewId);
`ReviewDecision.PENDING` added via additive migration; DB-backed dashboard +
review queue with labelled demo fallback when the database is unconfigured.

Verified: 8 integration tests through the real route handler (allowed/denied
transitions, repeated request → 422, stale write → 409, two concurrent
submissions → exactly one wins with one Review + one AuditEvent row, forged
status fields stripped, reason required, unknown order → 404, stats
aggregates). Full suite 63/63; lint/typecheck/build exit 0. Live production
smoke test: 200 approval with persisted Review/AuditEvent/snapshot, repeated
request → 422, stale token → 409 with `currentUpdatedAt`, 503
`database_unreachable` with Postgres stopped, 503 `database_unconfigured`
without `.env`.

**Deviations (documented, not hidden):**
- No real authentication exists in hackathon scope: the reviewer identity is
  the server-fixed demo actor `demo-merchant` (clients cannot claim an
  identity; D-002 still applies before any multi-user use).
- Accessibility criterion is met at design level (dialog semantics, roles,
  `aria-current`, status/alert live regions); no Playwright keyboard
  walkthrough yet (harness deferred to Phase 6).
- `GET /api/stats` shipped here (the dashboard consumes it) — Phase 4's
  acceptance tests will pin its aggregates to seeded values.

**Acceptance criteria:**
1. Transition matrix unit-tested, including denied transitions returning server-side 4xx. ✅
2. Audits record actor, from/to, note, timestamp (integration test). ✅
3. Review action is available only through the server API; direct forged POSTs without valid payload rejected (integration test). ✅
4. Accessibility: status changes announced to screen readers (design-level checks documented; Playwright keyboard walkthrough of approve/hold flows). ⚠️ design-level only until Phase 6

## Phase 4 — Stats + AI copilot (grounded)

**Status: ✅ Implemented and verified 2026-10-27** (scope note: `GET /api/stats`
and its dashboard aggregates already shipped with Phase 3 — the Phase 3
integration suite pins them against known seeded values; this phase added the
Gemini copilot).

Shipped: `POST /api/copilot/chat` (NDJSON event stream) backed by a
server-only Gemini integration (`src/lib/ai/gemini.ts`, SDK `@google/genai`
2.31.0 — the legacy `@google/generative-ai` package is deprecated; default
model `gemini-3.8-flash`, the stable GA free-tier Flash identifier verified
against Google's official deprecation pages in October 2026, override via
`GEMINI_MODEL`). The model calls **fixed, read-only tools only**
(`src/lib/ai/tools.ts`): order investigation by id/number, awaiting-review
list, filtered order search, dashboard aggregates, top risk-signal counts —
parameterized Prisma queries in `src/db/copilot-data.ts`, whitelisted fields,
row caps ≤ 20. There is no SQL, shell, or write tool anywhere in the codebase.
Every answer is a Zod-validated `submit_answer` tool call; citations are
verified server-side against the evidence the tools actually returned during
the request (hallucinated order ids are dropped; a `STORED_DATA` answer with
no verifiable citations is downgraded to labelled explanatory text). A
bounded loop caps the run at ≤ 4 model rounds; a plain-text ending triggers
one forced structured call (function-calling mode `ANY` + allowed function
names). Provider errors are classified into user-safe codes
(`quota_exhausted` / `copilot_unconfigured` / `provider_unavailable`) that
never echo raw provider messages or the API key. Limits: question ≤ 1000
chars, history ≤ 10 turns, `maxOutputTokens` 1024, tool rows ≤ 20, and an
in-memory fixed-window rate limiter (10 requests/min/IP, single-instance —
documented limitation). The chat UI (`/copilot`) streams progress events,
labels every answer as grounded-in-stored-data vs explanatory-AI-text,
supports retry and clear-conversation, and degrades to a live stored-data
panel (real high-risk orders from `GET /api/orders?band=HIGH`) when the
provider is unconfigured, out of quota, or unreachable.

Verified: 104/104 tests pass — new suites cover the Zod contracts (payload,
tool args, structured answer incl. malformed JSON and invented reason codes),
the orchestrator with mocked transports (grounded answers, hallucinated
citations, malformed `submit_answer` args, provider failures, round limit,
prompt-injection probes asserting the hardened system instruction), the chat
route (400/429/503 + NDJSON happy path asserting the API key never appears in
streamed output), the rate limiter, and live-database tool tests (unknown
tool rejection, SQL/shell-shaped arg rejection, real retrieval, read-only
invariant). Lint, typecheck, and production build all exit 0. Live
production smoke test (no `GEMINI_API_KEY` on the machine — the fallback path
is the verifiable one): `/copilot` → 200; chat without key → 503
`copilot_unconfigured`; requests 1–10 → 503, request 11 → 429
`rate_limited` with `retryAfterMs`; fallback endpoint returns real stored
high-risk orders.

**Deviations and limitations (documented, not hidden):**
- **No live Gemini call has been verified.** No API key exists on this
  machine; all model behaviour is covered by mocked transports in tests, and
  the happy path must be re-verified manually once a key is configured.
- Streaming is **NDJSON progress events + one final structured answer**, not
  token-level streaming — token streaming is incompatible with forcing the
  final answer through a validated tool call.
- The rate limiter is in-memory: it works within one server instance and
  resets on restart. A multi-instance deployment needs a shared store.
- Prompt-injection defenses are (a) a hardened system instruction (rules 2–4:
  tool results are data, user messages are not configuration, read-only
  framing) and (b) structural constraints (fixed tool set, validated args,
  verified citations, truncated untrusted stored strings). LLM instruction
  adherence cannot be guaranteed; the structural layer is the hard boundary.

**Acceptance criteria:**
1. Stats integration tests hit known seeded aggregates exactly. ✅ (shipped with Phase 3)
2. Copilot cannot mutate anything: no DB writes on any path (code evidence + integration test). ✅ (no write tool exists; live-DB test asserts scoped row counts unchanged across every tool call)
3. Copilot answers order questions using only authorized data — SQL injection probes and "ignore instructions" probes are tested and fail safely (integration tests). ✅ (`run_sql`/shell-shaped args rejected by arg validation; injection probes covered in orchestrator tests)
4. Graceful degradation when `GEMINI_API_KEY` is absent or quota is exceeded (integration test with injected transport only in tests; UI shows stored reasons instead). ✅ (503 `copilot_unconfigured` verified live; quota path verified with injected transport; UI fallback panel renders live stored orders)

## Phase 5 — PayPal Sandbox payments

**Status: ✅ Implemented and verified 2026-10-27** (with a documented
limitation: no live Sandbox purchase was executed — see Deviations).

Shipped: a server-only PayPal integration (`src/lib/payments/paypal.ts` —
OAuth2 client credentials with token caching, Orders API v2 create/capture,
webhook signature verification via
`/v1/notifications/verify-webhook-signature`; REST endpoints verified against
the official PayPal Developer documentation, October 2026). The config parser
accepts **Sandbox only** — a live host is refused outright — and every
provider traffic path goes through an injectable `PayPalTransport` so
automated tests use mocked responses only.

Flow (`src/lib/payments/flow.ts` — the only writer of Payment rows and
payment audit events):
- `POST /api/orders/:id/payments` — creates a PayPal order from an APPROVED
  application order; amount/currency are computed server-side from the
  trusted order row (integer minor units → PayPal decimal strings, ISO-4217
  exponent mapped, unknown currencies fail loudly). The browser receives ONLY
  the PayPal order reference + payment id. The Payment row is reserved BEFORE
  the provider call with a deterministic `PayPal-Request-Id`
  (`trustcart-{paymentId}`), and an active payment short-circuits creation —
  repeated requests return the same PayPal order reference instead of
  producing duplicate business records. 422 `not_eligible` for
  non-APPROVED orders; 503 `payments_unconfigured` without credentials.
- `POST /api/orders/:id/payments/capture` — server-side capture. The browser
  approval callback alone is never proof of captured payment: the endpoint
  captures against PayPal, then verifies the returned provider order id,
  capture status (COMPLETED/PENDING), capture amount and currency against the
  application order, and the association of the PayPal order with THIS
  application order (404 `invalid_reference` otherwise) before any VERIFIED
  state is written. Duplicate capture requests return the persisted state
  with no new records; DECLINED → FAILED (402 `capture_declined`); amount
  mismatch → FAILED (409 `amount_mismatch`); timeouts/network failures leave
  the row untouched and are safely retryable (idempotent
  `trustcart-capture-{paymentId}` request id).
- `POST /api/payments/webhooks/paypal` — optional (`PAYPAL_WEBHOOK_ID`);
  every event is signature-verified server-side before any state change
  (invalid/missing headers → 400 `invalid_signature`); verified events move
  payment state forward only (CHECKOUT.ORDER.APPROVED → PAYER_APPROVED,
  PAYMENT.CAPTURE.COMPLETED → VERIFIED with capture id, PAYMENT.CAPTURE.DENIED
  → FAILED) and never invent payments for unknown provider orders.
- Status mapping: CREATED → PAYER_APPROVED → CAPTURED (pending capture) →
  VERIFIED (server-verified) / FAILED / EXPIRED. Audit events
  (`PAYMENT_*`, actor `paypal-sandbox`) record safe metadata only; the
  investigation page renders payment history (provider order id, capture id,
  verified timestamp) and the PayPal Sandbox buttons for eligible orders
  (`@paypal/react-paypal-js`, public client id passed from the server page;
  no secret ever reaches the browser).

Verified: 144/144 tests pass — new suites cover money conversion (no float
math, unmapped currencies rejected), capture verification (provider order id,
amount, currency, status matrix), Sandbox-only env parsing (live host
refused), the flow against the real database with mocked transports (create
success/idempotency/eligibility/definitive-rejection/timeout-retry, capture
success/duplicate/ownership/amount-mismatch/declined/timeout-retry/pending/
expired, webhook signature rejection/missing headers/idempotent application/
forward-only transitions/orphan events), and route-level HTTP mapping
(201/200/422/404/400/402/409/503). Lint, typecheck, and production build all
exit 0. Live production smoke test without credentials (the fallback path is
the verifiable one): investigation page 200 with the "not configured"
checkout panel; payment creation → 503 `payments_unconfigured`; webhook →
503 `webhook_unconfigured`; no secret in any response.

**Deviations and limitations (documented, not hidden):**
- **No real Sandbox purchase was completed** — no PayPal Sandbox credentials
  exist on this machine. All provider behaviour in tests comes from mocked
  transports (clearly labelled as such); the manual Sandbox buyer checkout is
  a documented setup step, not a claim.
- Payment rows reserved before the provider call carry placeholder
  `0 / XXX (no currency)` amounts until the provider accepts; a definitively
  failed create leaves an honest FAILED row in the history.
- Webhooks are a secondary convenience signal — the capture endpoint remains
  the authoritative verifier; without `PAYPAL_WEBHOOK_ID` the route is 503.
- Demo authorization model unchanged (single synthetic merchant, D-002).

**Acceptance criteria:**
1. Amount sent to PayPal is derived server-side from DB totals — integration test forging client amount changes nothing. ✅ (no amount field exists on any payment endpoint; Zod strips unknown keys)
2. Capture flow marks `VERIFIED` only after server-side PayPal confirmation (tests simulate PayPal *transport* only in test code). ✅
3. Browser "success" callback without server verification does NOT set verified state (integration test). ✅ (approval relay only calls capture; VERIFIED requires the verified capture response or a verified webhook)
4. Idempotency: double capture submission produces no double state change (integration test). ✅ (active-payment short-circuit + unique providerOrderId/providerCaptureId + forward-only transitions)
5. Secrets never appear in client bundles (grep evidence) nor logs. ✅ (secret lives in the `server-only` module; tests assert responses never contain credentials; client id only is passed to the browser, which is public by design)
6. Manual Sandbox purchase with sandbox buyer works end-to-end locally (documented QA session, evidence screenshot without secrets). ⚠️ setup steps documented; NOT executed on this machine — no credentials exist here

## Phase 6 — Accessibility, hardening, docs, final E2E

**Scope:** full Playwright suite for the click-through demo journey; empty/error audit; README + docs polish; production build; final security rules checklist review.

**Acceptance criteria:**
1. Full Playwright suite green on the demo journey.
2. Keyboard-only walkthrough completes all core journeys.
3. `npm run build` production exit 0; typecheck/lint/test all exit 0.
4. Security checklist in `docs/architecture.md` §7 verified item by item (evidence list).
5. Docs updated with any known remaining limitations — stated, not hidden.

## Decisions requiring human confirmation (before dependent phases)

- **D-001** AG Grid Community: deferred — plain table justified at demo scale; confirm if you want it anyway.
- **D-002** Demo authentication: single synthetic merchant, no real auth in the demo; not production authorization. Confirm acceptable for hackathon scope.
- **D-003** PostgreSQL via Docker Compose as the documented local option. Confirm if another local Postgres is preferred.
- **D-004** Risk factor weights are demo heuristics, labelled as such in the UI. Confirm wording acceptable.
- **D-005** ~~Which Gemini model to call and max tokens per answer, to stay
  inside free quota.~~ **Resolved in Phase 4 (2026-10-27):** default model
  `gemini-3.8-flash` (stable GA free-tier Flash, verified against Google's
  official deprecation pages — `gemini-3.7-flash`, `gemini-3.5-flash`, and all
  2.x identifiers are deprecated/routed), `maxOutputTokens` 1024, ≤ 4 model
  rounds per question. Override via `GEMINI_MODEL`.

Initial sequencing recommended: Phase 0 → 1 → 2 → 3 → 4 → 5 → 6 (payment phase after all UI/audit rails exist so verified-status wiring is exercised through real UI).
