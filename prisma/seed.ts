import "dotenv/config";
import { getPrisma } from "@/db/client";
import { RISK_RULES_VERSION } from "@/lib/risk/rules";
import { generateSyntheticDataset } from "@/seed/generate-demo-orders";
import type { EvaluationLabel, ReviewDecision, RiskLevel } from "@/generated/prisma/client";

/**
 * Repeatable synthetic data seed (Phase 2/3).
 *
 * Usage (via Prisma config): `npx prisma db seed`
 *   npx prisma db seed -- --count=800 --seed=20261027
 *   npx prisma db seed -- --count=1200 --replace   # replaces demo data
 *
 * Guards:
 * - Refuses to run when orders already exist without `--replace`
 *   (destructive operations require an explicit flag — see AGENTS.md).
 * - `--replace` deletes ALL order rows (with cascading reviews, assessments,
 *   and eval labels) in the target database — intended only for this local
 *   demo dev database, never for shared or production data.
 * - Never writes Payment rows: real payment records can only come from
 *   the server-side PayPal flow in a later phase.
 * - Deterministic: same (seed, count) always produces the same dataset.
 */

const MIN_COUNT = 500;
const MAX_COUNT = 2000;

function parseIntArg(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value)) {
    throw new Error(`Invalid ${name}: ${raw}`);
  }
  return value;
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name: string): string | undefined => {
    const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (!hit) return undefined;
    return hit.includes("=") ? hit.split("=")[1] : (args[args.indexOf(hit) + 1] ?? undefined);
  };

  const count = parseIntArg(getArg("count"), 800, "count");
  const seed = parseIntArg(getArg("seed"), 20261027, "seed");
  const replace = args.includes("--replace") || getArg("replace") !== undefined;

  if (count < MIN_COUNT || count > MAX_COUNT) {
    throw new Error(`--count must be between ${MIN_COUNT} and ${MAX_COUNT} (got ${count})`);
  }

  const prisma = getPrisma();
  if (!prisma) {
    console.error("DATABASE_URL is missing or invalid. Local development:");
    console.error("  docker compose up -d      # start PostgreSQL");
    console.error("  npm run db:migrate        # apply migrations");
    console.error("  npm run db:seed           # this script");
    process.exitCode = 1;
    return;
  }

  if (!replace) {
    const existing = await prisma.order.count();
    if (existing > 0) {
      console.error(
        `Refusing to seed: ${existing} order(s) already exist in this database. Re-run with --replace to DELETE ALL orders in this demo dev database before reseeding.`,
      );
      process.exitCode = 1;
      return;
    }
  } else {
    console.log(
      "Replacing dataset: deleting ALL order rows (with cascading reviews, assessments, payments, eval labels) in this demo dev database…",
    );
    await prisma.order.deleteMany({});
  }

  const dataset = generateSyntheticDataset(seed, count);
  console.log(`Seeding ${dataset.orders.length} synthetic orders (seed=${seed})…`);

  const startedAt = Date.now();
  // 800×(order+risk+review+label) inserts exceed the default 5s
  // interactive-transaction budget, so the timeouts are raised for this
  // deliberately all-or-nothing seed transaction.
  await prisma.$transaction(
    dataset.orders.map((o) =>
      prisma.order.create({
        data: {
          orderNumber: o.orderNumber,
          amount: o.amount,
          currency: o.currency,
          itemCount: o.itemCount,
          customerName: o.customerName,
          customerEmail: o.customerEmail,
          shippingCountry: o.shippingCountry,
          accountAgeDays: o.accountAgeDays,
          recentOrderCount: o.recentOrderCount,
          shippingMismatch: o.shippingMismatch,
          orderStatus: o.orderStatus,
          createdAt: o.createdAt,
          ...(o.risk
            ? {
                riskAssessment: {
                  create: {
                    score: o.risk.score,
                    level: o.risk.level as RiskLevel,
                    reasons: o.risk.reasons as object,
                    rulesVersion: o.risk.rulesVersion,
                  },
                },
              }
            : {}),
          ...(o.review
            ? {
                reviews: {
                  create: {
                    reviewerId: o.review.reviewerId,
                    decision: o.review.decision as ReviewDecision,
                    note: o.review.note,
                    createdAt: o.createdAt,
                  },
                },
              }
            : {}),
          evalLabel: {
            create: { label: o.evalLabel as EvaluationLabel },
          },
        },
      }),
    ),
    { maxWait: 10_000, timeout: 120_000 },
  );

  const audit = await prisma.auditEvent.create({
    data: {
      entityType: "SYSTEM",
      entityId: "seed",
      action: "SEED_EXECUTED",
      actor: "seed@phase2",
      metadata: { count, seed, rulesVersion: RISK_RULES_VERSION },
    },
  });

  console.log(
    `Done: ${dataset.orders.length} orders, ${dataset.orders.filter((o) => o.review).length} reviews, 1 audit event (${audit.id}) in ${Date.now() - startedAt}ms.`,
  );
}

main()
  .then(async () => {
    await shutdownPrisma();
  })
  .catch(async (error) => {
    console.error(
      "Seed failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
    await shutdownPrisma();
  });

/**
 * Closes the pg pool so the process can exit; without this the idle pool
 * sockets keep the event loop alive and the script hangs forever.
 */
function shutdownPrisma(): Promise<void> {
  const prisma = getPrisma();
  return prisma ? prisma.$disconnect() : Promise.resolve();
}
