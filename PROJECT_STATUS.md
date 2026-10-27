# TrustCart AI — Project Status

Last verified: **2026-10-27** (Phase 6 QA / security review / E2E session).
Phase 6 (QA, security review, integration hardening, final E2E) is **complete** —
see the Phase 6 defect report and verification tables below.

## Phase status

| Phase | Scope | Status |
|---|---|---|
| 0–1 | Bootstrap, UI shell, order tables | ✅ Done |
| 2 | Prisma/PostgreSQL data model, synthetic seed, real risk engine | ✅ Done |
| 3 | Investigation view, review workflow (transitions, optimistic concurrency), audit timeline | ✅ Done |
| 4 | Gemini AI merchant copilot (read-only tools, grounded answers, DB fallback) | ✅ Done — verified below |
| 5 | PayPal Sandbox payments (server-side create/capture/verify, idempotent, webhooks) | ✅ Done — verified below |
| 6 | QA, security review, integration hardening, final E2E | ✅ Done — verified below |

## ⚠️ Required: rotate provider credentials

During the Phase 6 review, `.env.example` was found to contain what appeared to
be **real provider credentials** (`GEMINI_API_KEY`, `PAYPAL_CLIENT_ID`,
`PAYPAL_CLIENT_SECRET`) instead of placeholders. The file now contains
placeholders only, but any credential that was ever pasted into it must be
treated as exposed:

- **Rotate the Gemini API key** in Google AI Studio.
- **Rotate the PayPal Sandbox client id/secret** in the PayPal developer
  dashboard (Sandbox keys can still spend sandbox money — treat them as
  secrets regardless).
- **Rotate the database password** if it ever differed from the local-only
  `docker-compose.yml` value documented in `.env.example`.

This is a human action the agent cannot perform. It is tracked here because it
is a security requirement, not optional cleanup. The placeholder file itself
was verified: every value in `.env.example` is now a non-secret placeholder.

## Verification environment (2026-10-27)

- Windows 11, Node v24, Next.js 16.4.3 (Turbopack), Vitest 5, Prisma 7.10.1.
- Docker PostgreSQL reachable on port 54329 (`DATABASE_URL` set in `.env`).
- Playwright E2E with two isolated production-server environments
  (`playwright.config.ts`): **core** (port 3100, provider keys blanked →
  deterministic unconfigured/fallback states) and **checkout** (port 3101,
  fake-but-valid-shaped PayPal keys → checkout UI renders, SDK and payment API
  calls stubbed in the browser). Both share the real seeded PostgreSQL
  database from `.env`.
- `.env` now contains **real provider credentials**: `GEMINI_API_KEY`,
  `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` are all **SET** (values never
  printed, never committed — `.env` is gitignored). This is a change during
  the session: earlier smoke tests ran with no credentials and verified the
  unconfigured fallbacks (503 `copilot_unconfigured` / `payments_unconfigured`
  / `webhook_unconfigured`); later smoke tests verified the configured paths.

## Commands executed and exit codes

| Command | Exit code | Result |
|---|---|---|
| `npm run lint` | 0 | clean |
| `npm run typecheck` | 0 | clean |
| `npm run test` (Vitest run) | 0 | **165/165 tests pass, 19/19 files** (two consecutive clean runs) |
| `npm run build` (`next build`) | 0 | all routes compiled, incl. 3 payment routes |
| `npm run test:e2e` (Playwright) | 0 | **13 passed, 1 skipped** — the REAL Sandbox test skips by design without buyer credentials |
| `npm start` + `curl` live smoke | — | see "Live verification" below |

No test was weakened or hidden to achieve these results. The single E2E skip
is the REAL-provider checkout test's documented, by-design skip when sandbox
buyer credentials are absent — a guard, not a weakened check.

## Defects found during verification — and fixes

Two confirmed Phase 5 defects were found by targeted regression tests and
fixed at the root cause. Both fixes preserve the security model (server-side
verification, idempotency, audit honesty).

1. **Concurrent captures double-wrote the `PAYMENT_VERIFIED` audit.**
   Evidence: new regression test `resolves CONCURRENT capture attempts…`
   failed (two audit rows, one payment). Fix: guarded transitions in
   `capturePaymentForOrder` (`updateMany` with
   `status: { notIn: ["VERIFIED", "CAPTURED"] }`) on the VERIFIED, CAPTURED
   and FAILED paths — exactly one request wins the state change and writes
   the audit; the loser still returns the final state without new records.

2. **A timed-out create reservation could never complete.**
   Evidence: 6 real `POST …/payments` attempts all returned the same
   `CREATED` reservation with `providerOrderId: null`; exactly 1
   `PAYMENT_CREATE_TIMEOUT` audit — retries never reached the provider
   because the active-payment short-circuit returned early. A merchant could
   get permanently stuck before checkout. Fix: a stale reservation (status
   `CREATED`, `providerOrderId === null`) now retries the provider call with
   the **same deterministic `PayPal-Request-Id`** (`trustcart-{paymentId}`),
   which PayPal replays idempotently — no duplicate PayPal order is possible.
   Payments that already have a provider order id keep the short-circuit.
   The timeout-retry integration test was strengthened to assert the
   reservation actually completes (provider id + amount written).

## Phase 6 defect report (prioritized)

Found by the Phase 6 QA/security review and the Playwright E2E run. Every fix
has a regression test that was confirmed failing before the fix and passing
after it.

### P1 — security

1. **`.env.example` contained real provider credentials instead of
   placeholders.** Evidence: review of the template file showed
   `GEMINI_API_KEY`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` populated with
   non-placeholder values; anything pasted into a template file must be treated
   as exposed. Fix: file replaced with explicit placeholders plus a rotation
   warning header. Rotation is required (section above).

### P2 — correctness / abuse resistance

2. **Payment create had a check-then-act race (TOCTOU).** Two concurrent
   creates could both observe "no active payment" and both call the provider.
   Evidence: new regression test "never creates a second reservation for
   concurrent creates…" failed before the fix. Fix:
   `pg_advisory_xact_lock(hashtext(orderId))` at the start of the create
   transaction (`src/lib/payments/flow.ts`) serializes concurrent creates per
   order; the regression test also asserts every provider call replays the
   SAME `PayPal-Request-Id` (idempotent replay, no duplicate PayPal orders).

3. **Money parsing could silently lose precision.** Provider amount strings
   were parsed through `Number(...)`, which loses precision at large
   magnitudes. Evidence: two new regression tests ("parses large in-range
   values exactly (pure integer parse)", "fails loudly instead of silently
   losing precision beyond the safe integer range") failed before the fix.
   Fix: pure integer string parsing with a loud failure outside the safe
   integer range (`src/lib/payments/money.ts`).

4. **Webhook endpoint accepted unbounded, unvalidated bodies.** Fix: Zod
   schema validation, a 128 KiB body cap (`WEBHOOK_MAX_BODY_BYTES`, rejected
   with 400 `malformed_payload`), and tightened webhook outcomes: a verified
   `PAYMENT.CAPTURE.COMPLETED` webhook is acknowledged informationally only —
   the capture endpoint remains the sole verifier, and no webhook can resurrect
   a FAILED payment (three new/updated regression tests).

5. **Copilot conversation recovery.** A malformed `submit_answer` args payload
   left the tool loop unable to continue cleanly (regression: "recovers when
   submit_answer args are malformed once, then succeeds"), and a trailing
   failed turn poisoned every retry request. Fix: functionResponse recovery in
   the orchestrator plus `dropTrailingFailedTurn`/`toApiHistory`
   (`src/components/copilot/chat-history.ts`, new 4-test regression suite).

### P3 — UI/UX and honesty

6. **Mobile (375 px) horizontal overflow — a real Tailwind v4 cascade bug.**
   `hidden sm:inline-flex` on `Button`/`Badge` never hid the element: Tailwind
   v4 emits base `.inline-flex` AFTER base `.hidden` in the compiled CSS
   (verified against the built `.next` CSS chunk: indices 7777 vs 7733), so the
   unvarianted `hidden` utility loses to the component's base `inline-flex`.
   Evidence: probe measured a 17 px document overflow on `/` — the header
   profile button's right edge sat at 392 px vs the 375 px viewport. Fix:
   variant-scoped `max-sm:hidden` / `max-md:hidden` in the app-shell header.
   Verified: 0 px overflow on all five app paths at 375 px.

7. **Copilot citations could carry reason codes the tools never returned.**
   Fix: dataset-level citations are filtered down to reason codes the tools
   actually reported; order-level citations keep their order reference but
   strip unreported reason codes (two new regression tests).

8. **Assorted UI/UX honesty fixes**, each verified by review or e2e:
   the review decision UI now refreshes the page so the audit timeline shows
   the recorded decision immediately; PayPal `onApprove`/capture errors are
   caught and rendered instead of crashing the route; `app/error.tsx`,
   `app/not-found.tsx`, `app/loading.tsx` added (honest failure/404/loading
   states); stale copy removed — demo risk bands are derived from the real
   engine (`levelForScore`) with a guard test, and a test asserts nothing
   "scheduled" is claimed that already shipped; an amount-mismatch capture
   response now reports the provider's actual amount/currency instead of only
   the expected ones; the header search dialog is DB-backed (validated
   `/api/orders` results instead of static links); provider error
   classification is field-bounded (`tests/unit/gemini-classify.spec.ts`);
   `listOrders` returns an empty page instead of an error when the requested
   page exceeds `pageCount`.

## Test inventory — all PASS (165/165)

All provider behaviour in automated tests is **mocked**; the database in
integration tests is the **real PostgreSQL** instance. No automated test
contacts Gemini or PayPal.

### Unit (103)

`tests/unit/risk-engine.spec.ts` (25) — PASS
- maps documented band edges exactly
- scores an empty order 0 / LOW with only the informational reason
- skips only the signal whose input is missing, not the others
- treats negative, fractional, and non-finite numbers as missing
- treats an unsupported currency as missing rather than applying USD thresholds
- fires exactly at the USD tier-1 boundary
- uses documented EUR/GBP thresholds
- selects the top value tier instead of stacking tiers (correlated signals)
- fires tier 1 at exactly 6 orders
- fires only the top velocity tier at 12 orders
- fires the very-new tier below 14 days
- fires the newer-account tier at exactly 14 days (14–89 band)
- fires the newer-account tier for 14–89 days and nothing at 90
- adds mismatch points only when the indicator is true
- fires odd hour inside 01:00–04:59 UTC only, evidence includes the timestamp
- sums independent signals and adds the compound bonus at exactly 3 categories
- counts value and account tiers as ONE category each for the compound rule
- does not add a compound bonus for fewer than 3 independent categories
- conflicting direction: brand-new account with otherwise calm signals stays moderate
- clamps at 100 and floors at 0
- is byte-identical for identical inputs (no clock or randomness)
- stamps the current rules version on every result
- gives every scoring reason non-empty explanation and evidence with labels+values
- formats minor units deterministically for evidence
- never reads the evaluation-only fraud-label table (source isolation guard)

`tests/unit/seed-generator.spec.ts` (11) — PASS
- produces identical datasets for identical (seed, count)
- produces different datasets for different seeds
- enforces the 500–2000 order count bounds
- enforces a positive 32-bit integer seed
- meets the documented exact class proportions
- uses the fixed base date and integer minor-unit money
- produces synthetic emails only (no real-customer data)
- keeps order numbers unique
- computes risk via the real engine (0–100, band-consistent, evidence present)
- keeps evaluation labels aligned with class-specific feature ranges
- never includes payment-related data

`tests/unit/order-query.spec.ts` (7) — PASS
- applies documented defaults to an empty query
- accepts and normalizes every supported parameter
- rejects a non-numeric page rather than coercing
- rejects out-of-range pagination
- rejects unknown filter enums
- rejects oversized search text
- accepts the maximum allowed page size

`tests/unit/copilot-schemas.spec.ts` (12) — PASS
- accepts a plain question with empty history
- rejects questions beyond 1000 characters
- rejects more than 10 history turns and non-enum roles
- accepts a well-formed orderNumber lookup
- rejects malformed order numbers and SQL-ish payloads
- bounds search filters (limit max 20, enum status/band)
- rejects an unparseable createdSince date
- accepts a valid grounded answer with citations
- rejects invented reason codes (fraud labels never enter the copilot)
- rejects oversized answers and more than 12 citations
- rejects malformed JSON-shaped garbage entirely
- requires CANNOT_ANSWER answers to still be strings and bounded

`tests/unit/copilot-orchestrator.spec.ts` (16) — PASS
- executes a data tool then accepts the validated submit_answer
- streams status events while tools run
- downgrades a STORED_DATA answer whose citations are hallucinated
- filters dataset-level citations down to the reason codes tools actually returned
- keeps an order-level citation but strips unreported reason codes
- recovers when submit_answer args are malformed once, then succeeds
- converts a plain-text ending into one forced structured submit_answer call
- fails with model_output_invalid when the model never submits a valid answer
- maps quota errors to quota_exhausted
- maps generic provider outages to provider_unavailable
- classifies a rejected API key as copilot_unconfigured
- passes the hardened system instruction for injection attempts and forwards the question as data only
- keeps injection text embedded in tool results as data (executor output is JSON, not commands)
- keeps citations that match retrieved evidence and filters wrong reason codes
- allows dataset-level reason-code citations that tools actually reported
- drops everything the tools never returned

`tests/unit/ratelimit.spec.ts` (3) — PASS

`tests/unit/payments-config.spec.ts` (4) — PASS
- returns null when credentials are absent (app boots, payments hidden)
- accepts Sandbox credentials without a base URL (sandbox default)
- refuses the LIVE PayPal host outright
- keeps the optional webhook id and rejects short credentials

`tests/unit/payments-money.spec.ts` (11) — PASS
- converts minor units to PayPal decimal strings without float math
- converts PayPal decimal strings back to integer minor units
- rejects malformed values and unmapped currencies loudly
- parses large in-range values exactly (pure integer parse)
- fails loudly instead of silently losing precision beyond the safe integer range
- accepts a COMPLETED capture that matches order id, amount, and currency
- accepts a PENDING capture (mapped to CAPTURED, not VERIFIED)
- rejects an amount mismatch and reports the provider's actual amount
- rejects a currency mismatch even for the same numeric amount
- rejects a capture response for a DIFFERENT PayPal order id
- rejects DECLINED and unexpected statuses

`tests/unit/env-validation.spec.ts` (5) — PASS
- returns null when the variable is unset / empty
- returns null for non-PostgreSQL connection strings
- accepts `postgresql://` and `postgres://` connection strings

`tests/unit/copilot-chat-history.spec.ts` (4) — PASS (Phase 6 regression suite)
- maps model turns to their answer text for the API history
- drops only the trailing failed user turn before a retry
- keeps history untouched when the last turn is a different message
- never drops a failed question that is not the last turn

`tests/unit/gemini-classify.spec.ts` (3) — PASS (Phase 6 regression suite)
- classifies a numeric status field
- ignores fields other than name/message/status
- still classifies Error instances by name and message

`tests/unit/demo-data.spec.ts` (2) — PASS (Phase 6 regression suite)
- maps every DEMO_ORDERS riskBand with the engine's levelForScore
- never claims shipped features are still scheduled

### Integration — real PostgreSQL, mocked providers (62)

`tests/integration/copilot-tools.spec.ts` (7) — PASS
- rejects unknown tools before any database access
- rejects shell-like and oversized identifiers via arg validation
- retrieves a real stored order context with its risk reasons and citations
- reports not_found honestly for unknown orders
- returns capped order lists for awaiting-review questions
- aggregates stored risk signals with human labels
- never mutates data through any tool path (scoped to the fixture row)

`tests/integration/copilot-route.spec.ts` (5) — PASS
- rejects malformed payloads with 400 invalid_payload
- rejects oversized questions with 400
- returns 503 copilot_unconfigured when no API key is set
- rate limits by client ip after the configured number of requests
- streams NDJSON events: status then a validated structured answer

`tests/integration/database.spec.ts` (8) — PASS
- enforces the unique orderNumber constraint
- cascades deletes to risk assessment, reviews, and eval labels
- listOrders filters by status (scoped to test rows via search marker)
- listOrders filters by risk band combined with search
- listOrders paginates deterministically with risk_high sort
- listOrders finds a single order by order number search
- listOrders returns an empty page (not an error) when page exceeds pageCount
- seed guard refuses to run when orders already exist

`tests/integration/reconciliation.spec.ts` (2) — PASS (Phase 6 regression suite)
- getDashboardStats reconciles with direct database aggregates
- every fixture's stored snapshot equals a fresh engine run

`tests/integration/review-workflow.spec.ts` (8) — PASS
- approves a pending order, persists decision + audit + fresh snapshot
- rejects a repeated request on the same transition (422 invalid_transition)
- rejects stale writes with 409 instead of overwriting (optimistic concurrency)
- lets exactly one of two concurrent submissions win (no silent overwrite)
- enforces the documented transition matrix server-side
- requires a reason and rejects forged/unknown fields
- returns 404 for unknown orders
- serves dashboard aggregates from stored engine snapshots

`tests/integration/payments-flow.spec.ts` (22) — PASS (mocked PayPal transport, real DB)
- creates a payment from trusted server-side order data and records an audit event
- is idempotent while the payment is active: the same PayPal order returns, no new row
- rejects creation for orders that are not APPROVED and for unknown orders
- records FAILED on a definitive provider rejection and allows a fresh attempt
- keeps the reservation retryable on a provider timeout (ambiguous outcome)
- verifies capture server-side and writes VERIFIED with capture id + audit
- returns the persisted state for duplicate capture requests (no new records)
- rejects a capture whose PayPal order belongs to a DIFFERENT application order
- marks the payment FAILED when the captured amount mismatches the order
- records DECLINED captures as FAILED (never VERIFIED)
- leaves the row untouched on a capture timeout, and an idempotent retry succeeds
- maps a PENDING provider capture to CAPTURED (not VERIFIED)
- refuses capture on FAILED/EXPIRED payments
- resolves CONCURRENT capture attempts with one transition and no duplicate audits
- never creates a second reservation for concurrent creates, and every provider call replays the SAME PayPal-Request-Id (Phase 6 regression test)
- rejects an event when signature verification fails
- rejects events with missing transmission headers as malformed_payload before verification
- acknowledges PAYMENT.CAPTURE.COMPLETED informationally — the capture endpoint stays the sole verifier
- never resurrects a FAILED payment to VERIFIED from a webhook
- rejects a malformed JSON body with malformed_payload before verification
- moves payments forward only: approved → payer_approved, denied → FAILED
- never invents payments for events referencing unknown PayPal orders

`tests/integration/payments-routes.spec.ts` (10) — PASS (mocked transport + config, real DB)
- returns 201 with ONLY the PayPal order reference (no secrets, no client data)
- returns 422 not_eligible for a non-APPROVED order and 404 for unknown ids
- returns 503 payments_unconfigured without credentials
- rejects malformed bodies with 400 and unknown references with 404
- maps a verified capture to 200 and an amount mismatch to 409
- maps a provider timeout to 503 provider_timeout with a retry-safe message
- ignores forged success fields: a forged capture body behaves identically to a clean one
- rejects an invalid webhook signature with 400 before any state change
- returns 503 webhook_unconfigured when no webhook id is set
- acknowledges a verified webhook with 200

## E2E verification (Playwright) — 13 passed, 1 skipped

`npm run test:e2e` — exit 0, single worker, against production builds and the
real seeded PostgreSQL database. Two isolated server environments
(`playwright.config.ts`):

- **core** (port 3100, provider keys blanked) — `tests/e2e/merchant-flows.spec.ts`:
  - dashboard KPIs reconcile with the `/api/stats` database aggregates
  - orders list: search, status filter, and pagination behave consistently
  - review approve flow persists a decision, refreshes the page, and writes an audit event
  - copilot degrades to a live stored-data fallback panel when unconfigured
  - payments: an approved order shows the labelled unconfigured panel; a pending order defers checkout
  - unknown routes render the app's own 404 page
  - responsive layouts: no horizontal overflow at mobile 375 / tablet 768 / desktop 1280 px
  - keyboard: search dialog opens via keyboard and closes on Escape
  - browser console stays clean during the dashboard and orders workflows

- **checkout** (port 3101, fake-but-valid-shaped PayPal keys) — `tests/e2e/sandbox-checkout.spec.ts`:
  - **(MOCKED)** sandbox checkout verifies server-side with a reference-only
    capture request — the PayPal SDK script and BOTH payment API calls are
    intercepted in the browser; nothing reaches PayPal and no payment rows are
    written. Trust-boundary assertions: the create request carries no
    browser-supplied body, and the capture request body contains ONLY the
    PayPal order reference — never amounts or statuses.
  - **(MOCKED)** a declined capture is shown honestly and never marked verified
  - **(REAL)** PayPal Sandbox checkout end-to-end — **SKIPPED** unless
    `PAYPAL_BUYER_EMAIL` / `PAYPAL_BUYER_PASSWORD` are configured. This test
    drives the real PayPal Sandbox popup with no stubs and must never be
    reported as passing without a real run. It did not run in this session.

The review-approve e2e is the only test that writes data into the demo
database (one Review + audit rows) — accepted and documented as a demo-data
side effect.

## Live verification — separated by class

### Local integration (real DB + mocked providers): PASS
All 165 automated tests plus the Playwright E2E suite above. Provider
responses are simulated fixtures, clearly labelled as such in every suite
header. No automated test contacts Gemini or PayPal (the two MOCKED checkout
tests stub the PayPal SDK at the browser level by design).

### Configured fallback paths (live production server, no key needed): PASS
- `/orders` 200; investigation page 200 with PayPal panel.
- Capture with malformed body → 400 `invalid_payload`.
- Webhook without `PAYPAL_WEBHOOK_ID` → 503 `webhook_unconfigured`.
- Earlier in the session (before credentials existed): copilot chat → 503
  `copilot_unconfigured`; payment create → 503 `payments_unconfigured`; rate
  limit 429 verified. No secret value ever appeared in any response.

### Real Gemini verification: PARTIAL — full run BLOCKED (provider capacity)
- The configured real provider **is used**: with `GEMINI_API_KEY` set, chat
  requests reach the Gemini API; the server log shows the SDK received a
  `functionCall` response (the tool-use loop started) — twice.
- A direct multi-turn diagnostic reproduced the orchestration with the real
  API: the call fails with `ApiError 503 UNAVAILABLE — "This model is
  currently experiencing high demand"` (3 distinct attempts, including one
  that stalled >180s). The app classifies this correctly and key-free as
  `provider_unavailable` with a retry message — exactly the designed
  behaviour for provider outages (Phase 4 item 5).
- A complete real-Gemini grounded answer could not be produced during this
  session purely because the free-tier model is overloaded. **BLOCKED**, not
  failed — the request/response path itself is verified up to the provider's
  503.

### Real PayPal Sandbox verification: BLOCKED (network egress degraded)
- Credentials are configured and validated server-side (the config parser
  accepted them; the payment create route attempted the real provider call).
- The machine's connection to `api-m.sandbox.paypal.com` is severely
  degraded: plain GETs succeed only intermittently (1 of 3, ~3–7s vs 0.2s to
  Google), and Node's undici connect consistently timed out (10s connect
  limit). 6 create attempts all failed at connect with a network error —
  the app handled each one correctly: reservation kept retryable, honest
  `PAYMENT_CREATE_TIMEOUT` audit, 503 with a retry-safe message.
- The idempotent-reservation design was verified **against the real provider
  path**: all 6 attempts returned the same single payment row — no duplicate
  PayPal orders or business records.
- A real buyer checkout (approval + capture) was **not** performed: it
  requires the human buyer steps and an egress path that currently does not
  connect reliably. No real payment was made and none is claimed. The new
  **(REAL)** Playwright test encodes the buyer procedure and skips until
  `PAYPAL_BUYER_EMAIL` / `PAYPAL_BUYER_PASSWORD` are provided; it has not run.

## Security review (Phases 4–5 boundaries preserved)

- Copilot is strictly read-only: no mutating tool exists; tools Zod-validate
  args; tool results are data, never instructions; citations are verified
  against retrieved evidence; the model can never change orders, risk scores,
  decisions, or payments.
- Payment amounts/currency/status are never accepted from the browser —
  computed from the trusted DB row and verified against the provider's
  capture response; forged-field test proves forged keys are stripped.
- `VERIFIED` is written only after server-side capture verification (provider
  order id, capture status, amount, currency, association) or a
  signature-verified webhook; browser approval alone is never trusted.
- Secrets stay server-side (`server-only` modules); responses never contain
  credentials (verified live); the PayPal client id is public by design;
  webhooks are signature-verified before any state change; the demo stores no
  card data (PayPal wallet flow only).
- Sandbox-only enforcement: the config parser refuses any non-Sandbox host.
- Phase 6 hardening: payment-create serialization per order
  (`pg_advisory_xact_lock`); pure integer money parsing with a loud failure
  outside the safe integer range; webhook Zod validation + 128 KiB body cap
  (`malformed_payload`); capture requests Zod-validated to the PayPal order
  reference only; `server-only` guards on every privileged module
  (`lib/ai/*`, `lib/payments/*`); input rate limiting preserved on the AI and
  payment routes; the header search dialog goes through the same validated
  `/api/orders` schema as the explorer.

## Known limitations

1. Real Gemini full-run and real Sandbox buyer checkout are BLOCKED as
   described above — environmental, not code defects. When egress/provider
   capacity is available, re-run the live smoke and (for PayPal) the **(REAL)**
   Playwright test with buyer credentials set.
2. The stale payment reservation on TC-3378 (from the egress-blocked real
   create attempts) remains in the demo data as an honest CREATED row; with
   the retry fix it will complete on the next successful create attempt.
3. Gemini model id `gemini-3.8-flash` is pinned by default; override with
   `GEMINI_MODEL`.
4. No git repository exists (documented Phase 0 deviation) — nothing is
   committed anywhere.
5. Demo authorization model: single synthetic merchant, no auth layer (D-002).
6. **Credential rotation is required** (section at the top of this document) —
   the Phase 6 review found real-looking provider keys in `.env.example`.
7. Playwright E2E needs the PostgreSQL instance from `.env` running and a
   prior `npm run build`; the review-approve e2e writes one Review + audit
   rows into the demo database (documented above).
8. The order explorer initializes its filters from component state only —
   URL query params are not read on load (the e2e suite drives the UI selects
   accordingly). Reading filters from the URL is a future improvement, not a
   defect.

## How to run

```powershell
npm install
npm run test        # 165 tests (integration tests need the Postgres instance)
npm run build       # production build (required before test:e2e)
npm run test:e2e    # Playwright E2E: 13 core/checkout tests + 1 REAL skip
npm run dev         # or: npm run build; npm start
```

Optional provider config in `.env` (placeholders in `.env.example`):
`GEMINI_API_KEY`/`GEMINI_MODEL`, `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET`/
`PAYPAL_WEBHOOK_ID`. The app boots and degrades honestly without any of them.
