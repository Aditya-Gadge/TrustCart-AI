import { describe, expect, it } from "vitest";
import { classifyProviderError } from "@/lib/ai/gemini";

/**
 * Phase 6 regression (security review finding): the classifier used to
 * JSON.stringify whole unknown error objects, feeding arbitrary fields
 * (which could include request configuration) into classification text.
 * It must only look at name/message/status-shaped signals.
 */
describe("provider error classification", () => {
  it("classifies a numeric status field", () => {
    expect(classifyProviderError({ status: 429 }).code).toBe("quota_exhausted");
    expect(classifyProviderError({ status: 403 }).code).toBe("copilot_unconfigured");
  });

  it("ignores fields other than name/message/status", () => {
    const classified = classifyProviderError({
      apiKey: "sk-secret-429",
      config: { quota: "exhausted" },
    });
    expect(classified.code).toBe("provider_unavailable");
    expect(classified.message).not.toContain("sk-secret");
  });

  it("still classifies Error instances by name and message", () => {
    expect(classifyProviderError(new Error("resource_exhausted")).code).toBe(
      "quota_exhausted",
    );
    expect(classifyProviderError(new Error("permission_denied")).code).toBe(
      "copilot_unconfigured",
    );
    expect(classifyProviderError(new Error("ECONNRESET")).code).toBe(
      "provider_unavailable",
    );
  });
});
