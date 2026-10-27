import { describe, expect, it } from "vitest";
import { parseDatabaseUrl } from "@/lib/env";

/**
 * Environment validation (Phase 2): DATABASE_URL is required to reach the
 * database and must be a PostgreSQL connection string when present. The
 * absent/unconfigured case must yield null (app still boots, demo fallback).
 */
describe("parseDatabaseUrl", () => {
  it("returns null when the variable is unset", () => {
    expect(parseDatabaseUrl(undefined)).toBeNull();
  });

  it("returns null when the variable is empty", () => {
    expect(parseDatabaseUrl("")).toBeNull();
  });

  it("returns null for non-PostgreSQL connection strings", () => {
    expect(parseDatabaseUrl("mysql://user:pass@localhost/db")).toBeNull();
    expect(parseDatabaseUrl("postgresuser")).toBeNull();
    expect(parseDatabaseUrl("HTTP://localhost")).toBeNull();
  });

  it("accepts postgresql:// connection strings", () => {
    const value = "postgresql://trustcart:pw@localhost:54329/trustcart";
    expect(parseDatabaseUrl(value)).toBe(value);
  });

  it("accepts postgres:// connection strings", () => {
    const value = "postgres://trustcart:pw@localhost:54329/trustcart";
    expect(parseDatabaseUrl(value)).toBe(value);
  });
});
