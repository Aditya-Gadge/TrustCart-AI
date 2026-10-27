import "server-only";
import { GoogleGenAI, FunctionCallingConfigMode } from "@google/genai";
import { z } from "zod";

/**
 * Server-only Gemini integration (Phase 4).
 *
 * - SDK: `@google/genai` (the current Google GenAI SDK — the legacy
 *   `@google/generative-ai` package is deprecated).
 * - Default model: `gemini-3.8-flash` (stable GA, free tier; verified against
 *   the official deprecation list in October 2026 — `gemini-3.7-flash` and
 *   all 2.x identifiers are deprecated). Override with GEMINI_MODEL.
 * - The API key NEVER leaves the server: this module is marked `server-only`,
 *   imported exclusively by the chat route, and the key is never logged or
 *   echoed in any response payload.
 * - All model traffic goes through the `ModelTransport` interface so tests
 *   can inject deterministic mocked responses without network access.
 */

const geminiEnvSchema = z.object({
  apiKey: z.string().trim().min(20, "GEMINI_API_KEY looks too short"),
  model: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9.\-]{2,64}$/i, "GEMINI_MODEL is not a valid model identifier"),
});

export type GeminiConfig = z.infer<typeof geminiEnvSchema>;

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

/** Validated config, or null when the copilot is not configured (app still boots). */
export function getGeminiConfig(): GeminiConfig | null {
  const rawKey = process.env.GEMINI_API_KEY;
  if (rawKey === undefined || rawKey === "") return null;
  const parsed = geminiEnvSchema.safeParse({
    apiKey: rawKey,
    model: process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
  });
  return parsed.success ? parsed.data : null;
}

/** Content part shapes the copilot orchestration needs (subset of the SDK). */
export type CopilotPart =
  | { text: string }
  | { functionCall: { name: string; args?: Record<string, unknown>; id?: string } }
  | {
      functionResponse: {
        name: string;
        response: Record<string, unknown>;
        id?: string;
      };
    };

export type CopilotContent = {
  role: "user" | "model";
  parts: CopilotPart[];
};

export type ModelGenerateArgs = {
  model: string;
  contents: CopilotContent[];
  config: {
    systemInstruction: string;
    tools: { functionDeclarations: readonly unknown[] }[];
    maxOutputTokens: number;
    temperature: number;
    functionCallingConfig?: {
      mode: "AUTO" | "ANY";
      allowedFunctionNames?: string[];
    };
  };
};

export type ModelGenerateResult = {
  functionCalls?: { name: string; args?: Record<string, unknown>; id?: string }[];
  text?: string | undefined;
};

export type ModelTransport = {
  generate: (args: ModelGenerateArgs) => Promise<ModelGenerateResult>;
};

const PROVIDER_TIMEOUT_MS = 30_000;

/** Classify a thrown provider error into a user-safe copilot error code. */
export function classifyProviderError(error: unknown): {
  code: "quota_exhausted" | "provider_unavailable" | "copilot_unconfigured";
  message: string;
} {
  // Only well-known, bounded fields are inspected (Phase 6): stringifying a
  // whole unknown error object could feed request configuration or other
  // unintended fields into the classification text.
  const parts: string[] = [];
  if (error instanceof Error) {
    parts.push(error.name, error.message);
  } else if (typeof error === "object" && error !== null) {
    const record = error as { name?: unknown; message?: unknown; status?: unknown };
    for (const field of [record.name, record.message, record.status]) {
      if (typeof field === "string") parts.push(field);
      else if (typeof field === "number") parts.push(String(field));
    }
  } else if (typeof error === "string") {
    parts.push(error);
  }
  const raw = parts.join(" ").slice(0, 300);
  const text = raw.toLowerCase();

  // Never echo raw provider messages that could contain the key or URL.
  if (
    text.includes("429") ||
    text.includes("resource_exhausted") ||
    text.includes("quota")
  ) {
    return {
      code: "quota_exhausted",
      message: "The Gemini free-tier quota is exhausted for now. Try again later.",
    };
  }
  if (
    text.includes("401") ||
    text.includes("403") ||
    text.includes("permission_denied") ||
    text.includes("api key") ||
    text.includes("api_key_invalid")
  ) {
    return {
      code: "copilot_unconfigured",
      message: "The stored Gemini API key was rejected. Check GEMINI_API_KEY.",
    };
  }
  return {
    code: "provider_unavailable",
    message: "The AI provider is unavailable right now. Try again shortly.",
  };
}

/** Real transport over @google/genai with a hard request timeout. */
export function createGeminiTransport(apiKey: string): ModelTransport {
  const ai = new GoogleGenAI({ apiKey });

  return {
    async generate(args: ModelGenerateArgs): Promise<ModelGenerateResult> {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("provider timeout after 30000ms")),
          PROVIDER_TIMEOUT_MS,
        ),
      );
      const call = (async () => {
        const response = await ai.models.generateContent({
          model: args.model,
          contents: args.contents as Parameters<
            typeof ai.models.generateContent
          >[0]["contents"],
          config: {
            systemInstruction: args.config.systemInstruction,
            tools: args.config.tools as Parameters<
              typeof ai.models.generateContent
            >[0]["config"] extends infer C
              ? C extends { tools?: infer T }
                ? T
                : never
              : never,
            maxOutputTokens: args.config.maxOutputTokens,
            temperature: args.config.temperature,
            ...(args.config.functionCallingConfig
              ? {
                  toolConfig: {
                    functionCallingConfig: {
                      mode:
                        args.config.functionCallingConfig.mode === "ANY"
                          ? FunctionCallingConfigMode.ANY
                          : FunctionCallingConfigMode.AUTO,
                      ...(args.config.functionCallingConfig.allowedFunctionNames
                        ? {
                            allowedFunctionNames:
                              args.config.functionCallingConfig.allowedFunctionNames,
                          }
                        : {}),
                    },
                  },
                }
              : {}),
          },
        });
        return {
          functionCalls: (response.functionCalls ?? []).map((call) => ({
            name: call.name ?? "",
            args: call.args as Record<string, unknown> | undefined,
            id: call.id ?? undefined,
          })),
          text: response.text ?? undefined,
        };
      })();

      return Promise.race([call, timeout]);
    },
  };
}
