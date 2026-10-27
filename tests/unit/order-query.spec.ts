import { describe, expect, it } from "vitest";
import { parseOrderQuery } from "@/lib/validation/order-query";

/**
 * Unit tests for validated order-list query parameters (Phase 2).
 * Unknown/malformed values must be rejected, never coerced silently.
 */
function search(entries: Record<string, string>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) params.set(key, value);
  return params;
}

describe("parseOrderQuery", () => {
  it("applies documented defaults to an empty query", () => {
    const result = parseOrderQuery(new URLSearchParams());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query).toEqual({
      page: 1,
      pageSize: 12,
      q: "",
      status: "ALL",
      band: "ALL",
      sort: "newest",
    });
  });

  it("accepts and normalizes every supported parameter", () => {
    const result = parseOrderQuery(
      search({
        page: "3",
        pageSize: "24",
        q: "  TC-3001  ",
        status: "APPROVED",
        band: "HIGH",
        sort: "risk_high",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.page).toBe(3);
    expect(result.query.pageSize).toBe(24);
    expect(result.query.q).toBe("TC-3001");
    expect(result.query.status).toBe("APPROVED");
    expect(result.query.band).toBe("HIGH");
    expect(result.query.sort).toBe("risk_high");
  });

  it("rejects a non-numeric page rather than coercing", () => {
    expect(parseOrderQuery(search({ page: "banana" })).ok).toBe(false);
  });

  it("rejects out-of-range pagination", () => {
    expect(parseOrderQuery(search({ page: "0" })).ok).toBe(false);
    expect(parseOrderQuery(search({ page: "-5" })).ok).toBe(false);
    expect(parseOrderQuery(search({ pageSize: "0" })).ok).toBe(false);
    expect(parseOrderQuery(search({ pageSize: "51" })).ok).toBe(false);
  });

  it("rejects unknown filter enums", () => {
    expect(parseOrderQuery(search({ status: "SHIPPED" })).ok).toBe(false);
    expect(parseOrderQuery(search({ band: "EXTREME" })).ok).toBe(false);
    expect(parseOrderQuery(search({ sort: "random" })).ok).toBe(false);
  });

  it("rejects oversized search text", () => {
    const q = "x".repeat(81);
    expect(parseOrderQuery(search({ q })).ok).toBe(false);
  });

  it("accepts the maximum allowed page size", () => {
    const result = parseOrderQuery(search({ pageSize: "50" }));
    expect(result.ok).toBe(true);
  });
});
