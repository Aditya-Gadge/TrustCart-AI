import type { EvaluationLabel, ReviewDecision } from "@/generated/prisma/client";
import { assessOrder } from "@/lib/risk/engine";

/**
 * Deterministic synthetic order generation (Phase 3).
 *
 * - Pure function of (seed, count): identical inputs produce equivalent
 *   datasets — covered by `tests/unit/seed-generator.spec.ts`.
 * - Money is integer minor units with explicit ISO-4217 currency.
 * - Customer names/emails are synthetic pools on RFC-2606 example
 *   domains — never real people.
 * - Risk snapshots come from the REAL deterministic engine
 *   (`src/lib/risk/engine.ts`, rules `demo-heuristics-v1`) — scoring inputs
 *   are order features only. The evaluation label is derived separately
 *   (`classFor`) and is NEVER an input to the score.
 * - No payment records are produced here, ever.
 */

export const SEED_ACTOR = "demo-merchant";
export const SEED_BASE_DATE = "2026-10-27T12:00:00.000Z";

/** mulberry32 — small deterministic PRNG, adequate for fixtures. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = [
  "Ava", "Lars", "Priya", "Tomás", "Mei", "Ola", "Jamal", "Elena", "Noah",
  "Sofía", "Henrik", "Issa", "Kate", "Diego", "Amina", "Yusuf", "Anna",
  "Felix", "Grace", "Milo", "Ruby", "Ethan", "Nadia", "Luca", "Nora", "Peter",
  "Zanele", "Kwame", "Sven", "Iris", "Omar", "Talia", "Bruno", "Hana",
  "Marcel", "Lena", "Idris", "Clara", "Tomasz", "Freja", "Rahim", "June",
  "Paolo", "Esin", "Dara", "Marta",
];
const LAST_NAMES = [
  "Meredith", "Östman", "Raghavan", "Ferreira", "Tanaka", "Nowak", "Okafor",
  "Sorina", "Bennett", "Márquez", "Søborg", "Traoré", "Whelan", "Herrera",
  "Diallo", "Kamal", "Kowalski", "Braun", "Lim", "Jansen", "Castellano",
  "Walsh", "Petrov", "Bianchi", "Lindqvist", "Adeyemi", "Pereira", "Novotná",
  "Kimura", "Sandoval", "Haapanen", "Aziz", "Moreau", "Silva", "Kaur",
  "Fischer",
];
const COUNTRIES = [
  "United States", "Canada", "United Kingdom", "Germany", "France", "Spain",
  "Italy", "Netherlands", "Poland", "Denmark", "Norway", "Sweden", "Ireland",
  "Romania", "Brazil", "Mexico", "Japan", "Singapore", "Australia",
  "New Zealand", "South Africa", "Turkey",
];
const CURRENCIES = ["USD", "USD", "USD", "USD", "USD", "USD", "EUR", "GBP"] as const;

export type SeedOrder = {
  orderNumber: string;
  amount: number;
  currency: string;
  itemCount: number;
  customerName: string;
  customerEmail: string;
  shippingCountry: string;
  accountAgeDays: number;
  recentOrderCount: number;
  shippingMismatch: boolean;
  orderStatus: "PENDING" | "APPROVED" | "HELD_FOR_REVIEW";
  createdAt: Date;
  risk: {
    score: number;
    level: "LOW" | "MEDIUM" | "HIGH";
    reasons: {
      code: string;
      label: string;
      points: number;
      explanation: string;
      evidence: { label: string; value: string }[];
    }[];
    rulesVersion: string;
  };
  review:
    | { reviewerId: string; decision: ReviewDecision; note: string | null }
    | null;
  evalLabel: EvaluationLabel;
};

export type SeedDataset = {
  seed: number;
  baseDate: string;
  orders: SeedOrder[];
};

function placeAt(index: number, base: Date): Date {
  // Deterministic ~21-day window around the base instant (up to 20 days
  // back, up to ~21h forward) with a rotating hour-of-day pattern.
  const dayOffset = Math.floor(index % 21);
  const hour = [9, 10, 11, 14, 16, 17, 20, 21, 3, 2, 15, 19][index % 12];
  const minute = (index * 13) % 60;
  return new Date(
    base.getTime() - dayOffset * 24 * 60 * 60 * 1000 + hour * 60 * 60 * 1000 + minute * 60 * 1000,
  );
}

/** Distribution slice by index — exact proportion guarantee. */
function classFor(index: number): EvaluationLabel {
  const slot = index % 100;
  if (slot < 68) return "ORDINARY";
  if (slot < 84) return "HIGH_VALUE";
  if (slot < 94) return "REPEATED";
  return "SUSPICIOUS";
}

export function generateSyntheticDataset(seed = 20261027, count = 800): SeedDataset {
  if (!Number.isInteger(seed) || seed < 1 || seed > 2_147_483_647) {
    throw new Error("seed must be a positive 32-bit integer");
  }
  if (!Number.isInteger(count) || count < 500 || count > 2000) {
    throw new Error("count must be between 500 and 2000");
  }
  const rand = mulberry32(seed);
  const base = new Date(SEED_BASE_DATE);
  const orders: SeedOrder[] = [];

  for (let i = 0; i < count; i += 1) {
    const klass = classFor(i);
    const first = FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)];
    const last = LAST_NAMES[Math.floor(rand() * LAST_NAMES.length)];
    const name = `${first} ${last}`;
    const email = `${first.toLowerCase()}.${last
      .toLowerCase()
      .replace(/[^a-z]/g, "")}${i}@demo.example`;
    const createdAt = placeAt(i, base);

    // Feature ranges per class (all independent of the eval label):
    const amount =
      klass === "HIGH_VALUE"
        ? 80_000 + Math.floor(rand() * 92_000)
        : klass === "SUSPICIOUS"
          ? 120_000 + Math.floor(rand() * 87_000)
          : 1_500 + Math.floor(rand() * 21_000);
    const itemCount =
      klass === "REPEATED" ? 1 + Math.floor(rand() * 3) : 1 + Math.floor(rand() * 8);
    const accountAgeDays =
      klass === "SUSPICIOUS"
        ? 1 + Math.floor(rand() * 12)
        : klass === "REPEATED"
          ? 200 + Math.floor(rand() * 700)
          : 30 + Math.floor(rand() * 870);
    const recentOrderCount =
      klass === "REPEATED"
        ? 6 + Math.floor(rand() * 9)
        : klass === "SUSPICIOUS"
          ? Math.floor(rand() * 3)
          : Math.floor(rand() * 4);
    const shippingMismatch = klass === "SUSPICIOUS" ? rand() < 0.85 : rand() < 0.06;
    const currency = CURRENCIES[Math.floor(rand() * CURRENCIES.length)];

    // Real deterministic engine — order features only, eval label never read.
    const assessment = assessOrder({
      amountMinor: amount,
      currency,
      accountAgeDays,
      recentOrderCount,
      shippingMismatch,
      placedAt: createdAt,
    });
    const { score, level, reasons, rulesVersion } = assessment;

    // Review workflow state from the score bands ("reviewed" history).
    const orderStatus: "PENDING" | "APPROVED" | "HELD_FOR_REVIEW" =
      level === "LOW" ? "APPROVED" : level === "HIGH" ? "HELD_FOR_REVIEW" : rand() < 0.5 ? "PENDING" : "APPROVED";
    const review =
      orderStatus === "PENDING"
        ? null
        : {
            reviewerId: SEED_ACTOR,
            decision: (orderStatus === "APPROVED" ? "APPROVED" : "HELD_FOR_REVIEW") as ReviewDecision,
            note:
              orderStatus === "APPROVED"
                ? rand() < 0.3 ? "Demo auto-approval band" : null
                : rand() < 0.4 ? "Demo held for follow-up" : null,
          };

    orders.push({
      orderNumber: `TC-${String(3000 + i)}`,
      amount,
      currency,
      itemCount,
      customerName: name,
      customerEmail: email,
      shippingCountry: COUNTRIES[Math.floor(rand() * COUNTRIES.length)],
      accountAgeDays,
      recentOrderCount,
      shippingMismatch,
      orderStatus,
      createdAt,
      risk: { score, level, reasons, rulesVersion },
      review,
      evalLabel: klass,
    });
  }

  return { seed, baseDate: SEED_BASE_DATE, orders };
}
