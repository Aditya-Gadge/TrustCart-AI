# TrustCart AI

**Explainable merchant order investigations and PayPal Sandbox payment
verification.** TrustCart AI is a hackathon demo for merchants and risk
operations teams who need to review suspicious orders with evidence they can
inspect, rather than opaque scores or automated rejection decisions.

> **Important:** TrustCart AI uses synthetic demo heuristics. It is not a
> validated fraud-detection system, does not predict fraud, and must not be
> used to make production payment, customer, or compliance decisions. The
> repository also has no merchant authentication yet; do not expose a live
> deployment or real customer data publicly.

## The problem and solution

Merchants reviewing orders need to understand why an order was flagged, make
and document a human decision, and verify that a payment was actually
captured. TrustCart brings these steps together:

- A deterministic, versioned risk score with per-rule evidence and
  explanations.
- A searchable order queue and investigation history.
- Human approve/hold decisions with server-side transition checks,
  concurrency protection, and audit events.
- A read-only AI copilot that answers from bounded, whitelisted queries over
  stored order data and verifies its citations.
- A PayPal Sandbox checkout where the server computes the amount and verifies
  the provider's capture before showing a payment as verified.

## Architecture and data flow

```text
Next.js App Router UI
  ├─ validated order, review, stats, copilot, and payment routes
  ├─ risk engine and AI/payment services (server only)
  └─ Prisma data-access layer
       └─ PostgreSQL (synthetic orders, assessments, reviews, payments, audit)

Copilot: browser question → Zod validation → bounded read-only tools
         → Gemini → validated answer + citations checked against retrieved data
PayPal:  browser approval → server creates/captures order → PayPal Sandbox
         → server verifies order/capture status, amount, and currency → DB
```

The AI cannot issue SQL or write to the database. It cannot change a risk
score, review decision, or payment state. The browser never supplies trusted
payment amounts or status. No card numbers or CVV data are stored.

## Technology

- Next.js 16 App Router, React 19, TypeScript (strict), Tailwind CSS 4
- PostgreSQL 16, Prisma ORM 7, `@prisma/adapter-pg`
- Zod request and model-output validation
- Google Gemini API (`@google/genai`) for the optional copilot
- PayPal Orders API v2 and `@paypal/react-paypal-js`, Sandbox only
- Vitest unit/integration tests and Playwright browser tests

## Local setup

Requirements: Node.js 24.x (see [`.nvmrc`](./.nvmrc)), npm 11.x, and Docker
Desktop (or a PostgreSQL database). The lockfile is committed; use `npm ci`
for a reproducible install. On Windows, stop local Next.js servers before
running `npm ci`; an active server can lock Next.js's native SWC binary.

```powershell
Copy-Item .env.example .env
# Edit .env and set DATABASE_URL to a local PostgreSQL connection.
npm ci
docker compose up -d
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Open `http://localhost:3000`. If the database is not configured, some list
and dashboard surfaces show clearly labelled synthetic fallback data; review
history and payment actions require PostgreSQL.

### Database migrations and demo data

- `npm run db:status` — inspect applied/pending migrations.
- `npm run db:migrate` — development-only `prisma migrate dev`.
- `npm run db:deploy` — apply committed migrations with `prisma migrate deploy`
  in a deployment/release operation. Back up important data first; apply
  migrations to a separate Preview database, not Production.
- `npm run db:seed` — add 800 deterministic synthetic orders to an empty
  database. Use `npm run db:seed -- --count=1000 --seed=20261027` to choose a
  repeatable count and seed.

The seed **refuses to write when any orders already exist**. This prevents
accidentally mixing demo fixtures into a populated database. `--replace` is
for an explicitly disposable local demo database only: it deletes all orders
and dependent data, and the script rejects it when `NODE_ENV=production`.
Never point seed or `--replace` at a database containing real records.

## Environment variables

Set secrets in the hosting provider's server-side environment configuration;
do not commit `.env`, copy secrets into `NEXT_PUBLIC_*`, or expose them in
screenshots or logs. `.env.example` contains only local-development defaults
and provider placeholders, not production credentials.

| Variable | Required? | Purpose |
|---|---|---|
| `DATABASE_URL` | For live DB-backed features | PostgreSQL URL. For serverless hosting, use the provider's pooled connection string and keep a separate database/branch for Preview. |
| `GEMINI_API_KEY` | Optional | Server-only Google AI Studio API key. Without it, Copilot returns an unconfigured state and the UI offers stored-data fallback. |
| `GEMINI_MODEL` | Optional | Gemini model ID available to your project. Defaults to `gemini-3.8-flash`; confirm current model availability and quota in AI Studio before relying on it. |
| `PAYPAL_CLIENT_ID` | Optional | PayPal Sandbox app client ID. This is passed to the PayPal browser SDK and is not a secret. |
| `PAYPAL_CLIENT_SECRET` | Optional | PayPal Sandbox app secret; server-side only. |
| `PAYPAL_BASE_URL` | Optional | Must be `https://api-m.sandbox.paypal.com`; the app rejects non-Sandbox hosts. |
| `PAYPAL_WEBHOOK_ID` | Optional | ID for the webhook configured in the PayPal developer dashboard. Leave unset if webhooks are not configured. |

Do not configure the PayPal production/live API host or production credentials:
this project intentionally supports Sandbox only.

## Deployment preparation

The project is configured for Next.js builds and Prisma client generation. A
candidate low-cost stack is Vercel Hobby plus a PostgreSQL provider with a
free tier (for example Neon), **subject to current plan rules, regional
availability, and usage limits**. [Render](https://paypalaihackathon.devpost.com/details/render)
is also a hackathon sponsor offering a free web-service tier and free
PostgreSQL, with a sponsor prize category — verify its current free-tier
limits and cold-start behaviour before choosing. Vercel's official Hobby plan
is restricted to non-commercial personal use; confirm that your hackathon
submission and account use are eligible before selecting it. See the
[Hobby plan limits](https://vercel.com/docs/plans/hobby) and
[pricing](https://vercel.com/pricing). No Vercel/Render account, database,
project, or deployment is configured by this repository, and there is no
deployment URL to report.

1. Create a dedicated PostgreSQL database for Production and a separate one
   for Preview. For a serverless deployment, use the database provider's
   pooled URL and TLS connection settings; place the app and DB in nearby
   regions. Free-tier suspension, connection, storage, and compute limits can
   affect cold starts and availability.
2. Connect the repository to Vercel and select Next.js. The project build
   command is `npm run build`; install uses the committed `package-lock.json`.
3. Configure `DATABASE_URL` separately for Production and Preview. Add
   `GEMINI_API_KEY`, `PAYPAL_CLIENT_ID`, and `PAYPAL_CLIENT_SECRET` only when
   enabling those features; set `PAYPAL_WEBHOOK_ID` only after webhook setup.
   Never use a Production URL in Preview.
4. Apply migrations deliberately with `DATABASE_URL=<production-url> npm run
   db:deploy` from a trusted release environment. Do **not** run migrations
   automatically in the build step, and do not seed Production.
5. Test the deployment using synthetic-only data, then validate the exact
   public origin, database queries, Gemini response/fallback, and PayPal
   Sandbox checkout. `GET /api/health` reports `{ status, database }` and is
   the intended health-check path for the hosting provider. Do not expose a
   deployment publicly until server-side merchant authentication and trusted
   rate-limit identity are implemented.

Vercel's free allowance is subject to account and product quotas and may pause
usage when limits are reached. Neon Free currently lists per-project compute,
storage, and data-transfer limits; verify current [Neon plan details](https://neon.com/pricing)
before deployment. For Prisma's serverless recommendations, see the [Prisma
ORM 7 Vercel deployment guide](https://www.prisma.io/docs/orm/v7/prisma-client/deployment/serverless/deploy-to-vercel)
and [Neon's pooled connection guidance](https://neon.com/docs/connect/connect-from-any-app).

## AI design, quotas, and fallback

Gemini receives a bounded question and conversation history. It can select
only fixed, read-only tools; inputs and final output are schema-validated,
and order/reason citations are checked against data retrieved during that
request. Stored notes and customer names are treated as untrusted text.

Gemini quotas vary by project, model, and usage tier; RPM, token, and daily
quotas may change, and free-tier access is limited. Check [current rate
limits](https://ai.google.dev/gemini-api/docs/rate-limits), [pricing](https://ai.google.dev/gemini-api/docs/pricing),
and the active project limits in AI Studio. On missing credentials, quota
exhaustion, or provider errors, the app provides a controlled error or
stored-data fallback instead of claiming an AI answer was produced.

The risk rules are deterministic heuristics created for synthetic data. They
are not trained or calibrated against real payment outcomes, and no accuracy
or fraud-prevention claim is made. Merchants, not AI, make decisions.

## PayPal Sandbox test procedure

This checkout uses PayPal Sandbox only. The repository test clearly
distinguishes browser-mocked checkout from a real Sandbox buyer run.

1. Create a **Sandbox** REST app and Sandbox buyer in the
   [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/applications/sandbox).
2. Configure `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` in the
   deployment's server environment. The client ID is public by design; keep
   the secret server-side.
3. Open an **APPROVED** synthetic order on the deployed HTTPS origin and
   complete checkout using the Sandbox buyer. Review the order's payment
   history and audit timeline; it should show `VERIFIED` only after server
   capture verification. A browser approval alone is not proof of payment.
4. Optional webhooks: create a Sandbox webhook using the exact deployed
   HTTPS URL `/api/payments/webhooks/paypal`, subscribe to the event types
   used by the app, and configure its ID as `PAYPAL_WEBHOOK_ID`. The webhook
   is signature-checked but is not allowed to verify a payment.
5. Do not claim a real Sandbox transaction unless the checkout completed
   against PayPal without mocks. See the official [REST app credential
   instructions](https://www.paypal.com/us/cshelp/article/how-do-i-create-paypal-rest-api-credentials-ts1949).

## Hackathon submission checks

Verified against the live listing and Devpost's public API on **October 27,
2026**: the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) is
**open**, with a submission period of **October 1 – November 12, 2026**
(Devpost's API reported "16 days left" on October 27, 2026, consistent with a
November 12, 2026 deadline). The exact deadline **time and timezone** could
not be independently verified because the rules page is bot-protected; an
earlier review of the official rules recorded **12:00 pm Pacific Time** on
November 12, 2026. Confirm the time on the live
[rules page](https://paypalaihackathon.devpost.com/rules) before submitting.

The current rules require a project that makes the PayPal Developer Platform
(Sandbox) central and also meaningfully incorporates AI; a project text
description; a functional demo — either a hosted demo URL **or** clear,
complete repository setup/run instructions (this README provides the latter);
identification of the AI tools used; a **public code repository with an
open-source license file visible at the top of the repository**; and a demo
video under three minutes, uploaded publicly to YouTube, showing the project
functioning on its target device. Projects may be new or existing, provided
meaningful progress happened during the submission period. Eligibility
includes age-of-majority and location requirements; read the full official
rules for exclusions and conditions. The verified judging categories are
technological implementation, design, potential impact, innovation/idea, and
presentation.

**Submission status:** the [MIT license](./LICENSE) now exists at the
repository root, satisfying the license-file requirement. Still outstanding
(owner actions, not yet performed or verified): pushing the repository to a
public GitHub/GitLab/Bitbucket URL; recording and uploading the public
YouTube demo video (timed script:
[`docs/demo-script.md`](./docs/demo-script.md)); optionally creating a hosted
demo deployment. No deployment URL is claimed and no video is claimed to
exist.

## Demo walkthrough

See [`docs/demo-script.md`](./docs/demo-script.md) for a timed,
under-three-minute walkthrough from dashboard through verified Sandbox
payment.

## Checks and tests

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Unit and integration tests use mocked provider calls; integration tests
require PostgreSQL. Playwright includes explicitly labelled mocked checkout
tests and a real Sandbox test that requires buyer credentials. The
integration and Playwright suites use the same local database and write test
records, so run the commands sequentially rather than concurrently. A skipped
real provider test is not a successful provider test. Current results and
unresolved security/deployment blockers are tracked in
[`PROJECT_STATUS.md`](./PROJECT_STATUS.md).

## Known limitations

- No merchant login/session or multi-tenant authorization exists; do not
  expose order details or state-changing routes publicly.
- Rate limiting is in-memory and uses request headers; it is not distributed
  or safe against spoofing unless a trusted proxy sanitizes client identity.
- Gemini quota and provider availability are external; fallback may be shown.
- PayPal live checkout is deliberately unsupported. A real Sandbox buyer
  checkout has not been verified in this environment.
- Free hosting/database plans have changing quotas, dormancy rules, and
  eligibility restrictions.

## License

Released under the [MIT License](./LICENSE). Basis for the choice: all source
files, tests, and documentation in this repository were authored for this
project; the only third-party-derived asset is the default `favicon.ico`
generated by `create-next-app` (Next.js and its templates are MIT licensed).
Dependencies are installed from their own packages at build time and keep
their own licenses; nothing else is redistributed.
