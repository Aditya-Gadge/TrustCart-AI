# TrustCart AI — Architecture

Status: Proposed, awaiting human approval. Governing rules: see root `AGENTS.md`.

## 1. Principles

1. **Layer separation** — `src/components` (UI) may call `src/lib/*` services; services may call `src/db`; nothing skips a layer. Payment, AI, and risk services never import each other's internals.
2. **Server authoritative** — every privileged operation validates input (Zod), checks authorization server-side, and derives state from the database, never from client payloads.
3. **Deterministic core** — the risk score is a pure function of stored data. AI may only explain; it never scores, approves, or rejects.
4. **Money discipline** — all amounts are integer minor units (e.g. cents) with explicit ISO-4217 currency codes. No floating-point arithmetic in any money path.
5. **Honest demo** — synthetic data only; no real customer data; no claim that demo rules reflect production fraud accuracy.

## 2. Directory layout (to be created in Phase 0/1)

```
src/
  app/              # Next.js App Router: pages + route handlers
    api/            # /api route handlers (server-only logic entrypoints)
    orders/         # investigation detail pages
  components/       # UI components only (no business logic, no DB access)
  lib/
    risk/           # deterministic risk engine (pure functions)
    payments/       # PayPal Sandbox service (server-side only)
    ai/             # Gemini copilot service (server-side only)
    validation/     # shared Zod schemas
    money.ts        # minor-unit helpers
  db/               # Prisma client + data access functions
  seed/             # synthetic dataset generation (repeatable)
docs/
tests/              # Vitest unit + integration tests
e2e/                # Playwright browser tests
prisma/             # schema.prisma + migrations
docker-compose.yml  # local PostgreSQL 16
```

## 3. Data model (Prisma, as built in the data-layer phase)

Implemented in `prisma/schema.prisma` (migrations `20261027103830_init`,
`20261027110059_review_decision_pending`).
All money columns are **integer minor units** with a sibling ISO-4217
`currency` code. Postgres 16, Prisma ORM 7 (Rust-free client + `@prisma/adapter-pg`).

| Model | Purpose | Key fields |
|---|---|---|
| `Order` | Synthetic demo order | `orderNumber` (unique, VarChar(24)), `amount` (Int minor units), `currency` VarChar(3), `itemCount`, `customerName`/`customerEmail` (synthetic values only), `shippingCountry`, risk-engine inputs `accountAgeDays`, `recentOrderCount`, `shippingMismatch`, `orderStatus` enum (`PENDING`/`APPROVED`/`HELD_FOR_REVIEW`), timestamps; indexes on `createdAt`, `orderStatus` |
| `RiskAssessment` | Current 1:1 explainability snapshot | `orderId` (unique), `score` 0–100, `level` enum (`LOW`/`MEDIUM`/`HIGH`), `reasons` Json `[{code,label,points,explanation,evidence:[{label,value}]}]`, `rulesVersion` (engine `demo-heuristics-v1`), `createdAt` |
| `Review` | Human decision history | `orderId`, `reviewerId` (server-fixed demo actor), `decision` enum (`APPROVED`/`HELD_FOR_REVIEW`/`PENDING` — reset decisions), `note?`, `createdAt`; index `(orderId, createdAt)` |
| `Payment` | PayPal linkage — **written only by the real server-side PayPal flow (later phase); the seed never fabricates rows** | `orderId`, `provider` (default `"paypal"`), `providerOrderId?` (unique), `providerCaptureId?` (unique), `status` enum (`CREATED`,`PAYER_APPROVED`,`CAPTURED`,`VERIFIED`,`FAILED`,`EXPIRED`), `amount`, `currency`, `verifiedAt?` (set only after server-side verification), timestamps |
| `AuditEvent` | Polymorphic audit log — deliberately **not** a foreign-key relation | `entityType` enum (`ORDER`/`REVIEW`/`PAYMENT`/`SYSTEM`), `entityId`, `action`, `actor`, `metadata` Json (safe, non-secret details only), `createdAt`; index `(entityType, entityId, createdAt)` |
| `EvalLabel` | **Evaluation-only** synthetic class label | `orderId` (unique), `label` enum (`ORDINARY`/`HIGH_VALUE`/`REPEATED`/`SUSPICIOUS`). Risk-scoring code must never read this table |

**Adaptations from the original draft (and why):**
- Draft's denormalized `riskScore`/`riskBand` columns → one-to-one
  `RiskAssessment` relation. A single current snapshot avoids dual sources of
  truth; band filtering and score sorting go through the relation join.
- Draft's per-factor `RiskFactor` rows → `reasons` JSON array on the snapshot
  for the demo rules (`demo-rules-v0`). A dedicated per-factor table can be
  reintroduced when engine versioning needs per-factor rows.
- Draft's `ReviewEvent` → split into `Review` (human decisions) and a generic
  `AuditEvent` log covering orders, reviews, payments, and system actions.
- `OrderItem`/`OrderAmounts` deferred until the investigation-detail phase
  consumes them (no speculative tables).
- `customerLabel`/`customerEmailLabel` → `customerName`/`customerEmail`
  holding synthetic values; sandbox `environment` marker on `Payment`
  deferred (this repo only ever targets PayPal Sandbox).

Never modeled: card numbers, CVV, PAN data (PayPal wallet flow; we store only PayPal identifiers and verification results).

## 4. Risk engine (deterministic, explainable) — as built in Phase 2/3

- Pure function `assessOrder(input) -> { score: 0–100, level, reasons, rulesVersion }`
  in `src/lib/risk/engine.ts`; same input → byte-identical output (no clock,
  no randomness, no I/O). Weights/thresholds live in the versioned catalogue
  `src/lib/risk/rules.ts` (`demo-heuristics-v1`).
- Signals: per-currency high-value tiers (mutually exclusive top-tier-wins),
  order velocity in a 30-day window (exclusive tiers), account age (exclusive
  tiers), shipping/billing mismatch indicator, odd-hour placement (01:00–04:59
  UTC), and a single documented compound bonus when ≥ 3 independent categories
  fire. Missing/invalid inputs yield a 0-point `DEMO_INCOMPLETE_DATA` reason
  (the related signal is skipped, never guessed).
- Each reason carries bounded points (sum clamped 0–100), a plain-language
  explanation, and the exact evidence (observed value + threshold) that
  justified it. v1 has no mitigating (negative) factors — documented demo
  limitation. Bands: HIGH ≥ 70, MEDIUM ≥ 35, else LOW.
- `rulesVersion` is stamped on every persisted snapshot; review actions
  re-run the engine server-side and upsert the snapshot. A source-scan test
  guarantees the engine never imports the evaluation-only label table or the
  DB client.
- The AI copilot (later phase) will consume these reasons to *explain* them;
  it cannot add/remove factors or flip review status.

## 5. API contracts (all server-side, all Zod-validated) — as built so far

| Method & path | Purpose | Notes |
|---|---|---|
| `GET /api/orders` | Search/filter/sort list | ✅ Zod query schema; server-side paging; 400 `invalid_query`, 503 `database_unconfigured`/`database_unreachable` |
| `POST /api/orders/:id/review` | Approve / hold / reset-to-pending | ✅ Zod body (`action`, reason ≥ 4 chars, `expectedUpdatedAt`); transition matrix + optimistic concurrency enforced server-side (409 `stale_write`, 422 `invalid_transition`); one transaction writes `Review` + fresh engine snapshot + `AuditEvent`; reviewer identity is server-fixed |
| `GET /api/stats` | KPI cards + trends | ✅ Aggregations from stored engine snapshots (`groupBy` + tagged-template raw query with no interpolated input) |
| `GET /api/orders/:id` | Investigation payload | Served by the `/orders/[id]` server component (`src/db/investigations.ts`) rather than a JSON route; a JSON endpoint can be added when a client needs it |
| `GET /api/orders/:id/audit` | Audit history | Included in the investigation payload; standalone route deferred |
| `POST /api/copilot/chat` | AI copilot | ✅ Zod-validated question (≤ 1000 chars) + history (≤ 10 turns); 10 req/min/IP rate limit → 429; 503 `database_unconfigured` / `copilot_unconfigured`; NDJSON event stream (`status`…`answer`|`error`); answers are Zod-validated `submit_answer` tool calls with server-verified citations; provider errors map to user-safe codes without echoing the key |
| `POST /api/orders/:id/payments` | Create PayPal order | ✅ Sandbox-only; amount/currency from the trusted order row (server-computed); returns only the PayPal order reference; idempotent while a payment is active; 422 `not_eligible`, 503 `payments_unconfigured` |
| `POST /api/orders/:id/payments/capture` | Capture + verify | ✅ Server-side capture then verification of provider order id, capture status/amount/currency, and association with the app order; duplicate captures replay persisted state; 402 `capture_declined`, 409 `amount_mismatch`, 503 `provider_timeout` |
| `POST /api/payments/webhooks/paypal` | Sandbox webhook | ✅ Signature verification via `/v1/notifications/verify-webhook-signature` before any state change (400 `invalid_signature`); idempotent forward-only transitions; 503 `webhook_unconfigured` without `PAYPAL_WEBHOOK_ID` |

### 5.1 Copilot contract (as built in Phase 4)

- **SDK & model:** `@google/genai` 2.31.0 (the current Google GenAI SDK; the
  legacy `@google/generative-ai` package is deprecated). Default model
  `gemini-3.8-flash` — stable GA, free tier, verified against Google's
  official deprecation pages (2026-10); `gemini-3.7-flash`, `gemini-3.5-flash`,
  and all 2.x identifiers are deprecated/routed. Override via `GEMINI_MODEL`
  (D-005 resolved).
- **Server-only boundary:** `src/lib/ai/gemini.ts` is marked `server-only`,
  imported only by the chat route. The API key never reaches the browser, is
  never logged, and never appears in any streamed payload (tested).
- **Tools are the only DB bridge:** five fixed read-only tools
  (`get_order_investigation`, `list_orders_awaiting_review`, `search_orders`,
  `get_dashboard_stats`, `get_top_risk_signals`) plus the required final
  `submit_answer` call. The model chooses names + JSON args only; every call
  passes Zod arg validation before the database sees it. No SQL, shell, or
  write tool exists in the codebase.
- **Structured output:** the run ends only through a Zod-validated
  `submit_answer` (`answer`, `answerType` = `STORED_DATA` | `EXPLANATORY` |
  `CANNOT_ANSWER`, citations, optional `dataGap`). Plain-text endings force
  one structured call (mode `ANY` + allowed function names). Bounded loop:
  ≤ 4 model rounds, `maxOutputTokens` 1024.
- **Citation verification:** order citations must match evidence the tools
  returned during the request; reason-code-only citations are allowed only
  for dataset-level facts the tools reported; an ungrounded `STORED_DATA`
  answer is downgraded to labelled explanatory text with a `dataGap`.
- **Answer labelling (honesty boundary):** every answer carries
  `dataSource` — `STORED_DATA` (facts read from the demo database this
  request), `AI_TEXT` (explanatory model text without stored evidence), or
  `NOT_ANSWERED` — plus a fixed server-authored disclaimer.
- **Injection posture:** hardened system instruction (tool results are data,
  never instructions; user messages are not configuration; read-only
  framing), untrusted stored strings truncated, provider errors classified
  into key-free user-safe codes. Instruction adherence is not guaranteed —
  the structural constraints above are the hard boundary.

### 5.2 Payments contract (as built in Phase 5)

- **SDK & APIs:** `@paypal/react-paypal-js` 10.6.1 for the browser buttons
  (public client id only); server-side Orders API v2 + OAuth2 client
  credentials + webhook signature verification over plain fetch against
  `https://api-m.sandbox.paypal.com` (the only accepted host — validation
  refuses live credentials/hosts).
- **Money integrity:** the browser never sends amounts, currency, or status.
  PayPal receives the decimal-string amount computed from the trusted order
  row (`src/lib/payments/money.ts`, integer minor units, no float math); the
  capture response's amount/currency are checked against the same row before
  VERIFIED is written.
- **Idempotency:** Payment rows are reserved before the provider call;
  deterministic `PayPal-Request-Id`s (`trustcart-{paymentId}`,
  `trustcart-capture-{paymentId}`) make provider-side retries replay safely;
  unique `providerOrderId`/`providerCaptureId` plus forward-only status
  transitions (CREATED → PAYER_APPROVED → CAPTURED/VERIFIED/FAILED/EXPIRED)
  prevent duplicate business records and invalid state changes.
- **Ambiguous failures** (timeout/network/malformed responses) never mark a
  payment FAILED — the row stays retryable and a later idempotent retry
  resolves the true outcome. Definitive provider rejections record FAILED
  with an audit event.
- **Webhooks** are optional and secondary: verified events only accelerate
  state the capture endpoint can also establish; unverified events are
  rejected with 400 and PayPal retries.
- **Audit:** every payment transition writes an `AuditEvent`
  (`entityType: PAYMENT`, actor `paypal-sandbox`, safe metadata only — no
  tokens, no secrets) shown in the investigation page's audit timeline.

| `POST /api/copilot/chat` | AI copilot | Later phase — Zod-validated question; authorized-data retrieval only; no SQL from natural language; AI output treated as untrusted text |

## 6. Environment variables (all server-side; `.env.example` committed; `.env` gitignored)

| Var | Purpose | Free tier |
|---|---|---|
| `DATABASE_URL` | Postgres connection (localhost via Docker) | local |
| `GEMINI_API_KEY` | Google AI Studio | free tier available, no card |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | Sandbox REST app | free, developer account |
| `PAYPAL_ENV` | `sandbox` (only supported value in demo) | — |
| `PAYPAL_BASE_URL` | `https://api-m.sandbox.paypal.com` | — |

No secrets in logs, screenshots, client bundles, or git. PayPal **client ID** is public by design (JS SDK) and may render in browser; client **secret** never leaves the server.

## 7. Security boundaries

- Demo authorization model: local demo with a single synthetic merchant; server treats all requests as that merchant. Real authentication is explicitly out of scope and documented (Decision D-002) — the app is not exposed publicly.
- Client may send: queries and review intents. Client may never send: scores, amounts, payment status, computed state (all recomputed server-side).
- AI output: never executed, never concatenated into SQL/commands; rendered as text only.
- Payment completion requires server-verified capture; browser success callbacks alone can never set `VERIFIED`.
- `.env` handling reviewed before any repo push; no credentials in screenshots.

## 8. Testing strategy

| Layer | Tool | Coverage focus |
|---|---|---|
| Unit | Vitest | Risk engine golden cases, money helpers, Zod schemas, review transition rules |
| Integration | Vitest + test Postgres | API route handlers, DB access, copilot authorization guard rails |
| Browser | Playwright | Dashboard, filter flow, investigation workflow, approval action, sandbox checkout journey |
| Static | `tsc --noEmit`, ESLint | Strict type and lint gates per change |

Palette rule: outbound PayPal/Gemini HTTP is simulated **only inside tests**, never in product code paths.

## 9. Risk register & free-tier limits

| Risk | Mitigation |
|---|---|
| Gemini free-tier rate limits bursty demo traffic | Cache explanations per order; degrade to stored risk-factor text when quota hit |
| Sandbox webhook delivery needs public URL | Demo verifies via capture-time server check first; webhook is hardening (Phase 5), optional at demo time |
| Local Postgres availability | Docker Compose one-command setup; documented reset procedure (manual only) |
| AG Grid bundle weight | Deferred (D-001); revisit only for large datasets |
| Single-merchant demo auth | Documented limitation (D-002); not a production-ready authorization claim |
