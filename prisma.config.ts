import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma ORM 7 CLI configuration.
 * The datasource URL intentionally lives HERE (not in schema.prisma —
 * deprecated in v7) and is loaded from the environment file.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
