import { z } from "zod";

/**
 * Environment validation (Phase 2): DATABASE_URL is required to reach the
 * database and must be a PostgreSQL connection string when present. The
 * app intentionally still boots without it (UI falls back to the demo
 * dataset) — provider secrets for Gemini/PayPal are validated in the
 * phases that actually read them.
 */
const databaseUrlSchema = z
  .string()
  .min(1, "DATABASE_URL is empty")
  .refine(
    (value) =>
      value.startsWith("postgresql://") || value.startsWith("postgres://"),
    {
      message:
        "DATABASE_URL must be a postgresql:// or postgres:// connection string",
    },
  );

export type DatabaseUrl = z.infer<typeof databaseUrlSchema>;

export function parseDatabaseUrl(
  raw: string | undefined,
): DatabaseUrl | null {
  if (raw === undefined || raw === "") return null;
  const parsed = databaseUrlSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Validated connection string, or null when the phase has no database. */
export function getDatabaseUrl(): DatabaseUrl | null {
  return parseDatabaseUrl(process.env.DATABASE_URL);
}
