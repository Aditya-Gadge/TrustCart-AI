# TrustCart AI — Agent Instructions

Durable, standing instructions for any AI agent working in this repository. These apply to every implementation task unless a task explicitly supersedes a rule, and only a human can authorize an exception to security-critical rules.

TrustCart AI is an AI-powered merchant risk investigation and payment intelligence application built for the PayPal AI Hackathon 2026.

> **Status:** This repository was empty when these instructions were written. Do not assume existing features, tests, or integrations exist until you inspect the code yourself. Do not create fake credentials, fake payment integrations, or placeholder features represented as production-ready functionality.

## Product objective

Build a functional merchant application that:

- Displays synthetic e-commerce orders.
- Calculates transparent, explainable risk scores.
- Helps merchants investigate and manage flagged orders.
- Provides an AI copilot grounded in stored order data.
- Supports PayPal Sandbox checkout and verified payment status.

## Required stack

- Next.js (App Router)
- TypeScript in strict mode
- Tailwind CSS
- Prisma
- PostgreSQL
- Zod (or an equivalent schema validator) for external input validation

## Architecture rules

- Keep UI components, domain logic, database access, payment services, and AI services separated. A layer may not reach past an adjacent layer.
- All privileged operations (risk actions, refunds, status changes, transaction verification) must enforce server-side authorization and validation, independent of client state.
- External inputs (API routes, forms, AI copilot requests) must be validated with Zod or an equivalent schema validator.
- Validate currencies explicitly.
- Use integer minor units (e.g., cents) for monetary arithmetic where appropriate. Floating-point money arithmetic is not acceptable where minor units apply.

## Security and trust rules (critical)

These rules have no exceptions except explicit human authorization:

- Never expose API keys, PayPal secrets, database credentials, or any other secrets to the browser. Secrets live server-side only.
- Never trust client-provided risk scores, payment statuses, prices, or merchant permissions. Recompute authoritative values server-side.
- Never mark a payment as completed solely because the browser reports success. Verify the transaction server-side with PayPal before recording a completed state.
- Keep risk scoring deterministic and explainable. The AI model must not independently make final payment or customer rejection decisions.
- Treat AI-generated explanations as untrusted output. Do not let natural-language requests execute arbitrary SQL or bypass authorization.

## Data rules

- Use synthetic demo data by default. Do not require real customer information.
- Never delete user data, reset a database, run destructive migrations, change secrets, or perform irreversible operations without explicit authorization.

## Honesty rules

- Never invent test results, payment confirmations, deployment URLs, or completed functionality.
- Report actual command output and exit codes from verification.
- Document limitations and any unverified behavior rather than presenting the feature as done.
- Do not replace working code with an unrelated rewrite.
- Do not hide errors or weaken tests to make a check pass; fix the root cause.

## Dependency policy

- Prefer stable, compatible, free-tier or open-source dependencies.
- Inspect existing dependencies before installing alternatives.
- Use official documentation and the Context7 MCP when available.
- Do not add unnecessary dependencies, MCP servers, or paid services.

## Loop engineering protocol

For every implementation task:

### A. Inspect
- Read the relevant files and identify dependencies.
- Inspect the existing git diff before editing.
- Identify risks and expected behavior.

### B. Plan
- Define the smallest implementation that meets the task.
- List files expected to change.
- State acceptance criteria and relevant tests.

### C. Implement
- Implement only the requested scope.
- Prefer small, maintainable changes.
- Preserve existing configuration unless a change is necessary.

### D. Verify
- Run the available lint, type-check, unit-test, integration-test, and build commands relevant to the change.
- Inspect actual command output and exit codes.
- Test failure cases, not just the happy path.
- Use browser tests for critical UI workflows when available.

### E. Repair
- Diagnose failures from evidence.
- Fix the root cause rather than hiding the error or weakening the test.
- Rerun every affected check.

### F. Accept
- Report completed changes, modified files, actual verification results, remaining failures, and known limitations.
- Do not claim success when required checks fail.
- Stop and request guidance if a destructive operation, missing credential, ambiguous requirement, or external dependency blocks safe progress.

## Loop limits

- Work on one bounded feature at a time.
- Do not begin the next phase until its acceptance criteria pass or its blockers are documented.
- Avoid repeatedly running identical failing commands without making a meaningful change.
- Never enter an unbounded autonomous repair loop.
- If the same failure persists after three distinct, evidence-based repair attempts, summarize the evidence and ask for guidance.

## Definition of done

A feature is done only when ALL of the following hold:

- Its intended behavior is implemented.
- Relevant automated tests pass.
- Linting and type checking pass when configured.
- The production build succeeds when applicable.
- Security implications have been reviewed.
- Limitations and any unverified behavior are documented.
