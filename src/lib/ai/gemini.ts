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
  | { text: string; thoughtSignature?: string }
  | {
      functionCall: {
        name: string;
        args?: Record<string, unknown>;
        id?: string;
      };
      /**
       * Gemini 3 models return an opaque PART-LEVEL thought signature on
       * functionCall parts that MUST be echoed back as a sibling of
       * `functionCall` when the model turn is replayed in a follow-up round.
       * Putting it inside the functionCall object (or omitting it) makes the
       * API reject the request with 400 INVALID_ARGUMENT
       * ("missing a thought_signature in functionCall parts").
       */
      thoughtSignature?: string;
    }
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

export type ModelFunctionCall = {
  name: string;
  args?: Record<string, unknown>;
  id?: string;
  /** Part-level thought signature to echo back with this call (Gemini 3). */
  thoughtSignature?: string;
};

export type ModelGenerateResult = {
  functionCalls?: ModelFunctionCall[];
  text?: string | undefined;
  /** Thought signature attached to the returned text part, if any. */
  textThoughtSignature?: string | undefined;
};

export type ModelTransport = {
  generate: (args: ModelGenerateArgs) => Promise<ModelGenerateResult>;
};

const PROVIDER_TIMEOUT_MS = 30_000;

/**
 * Bounded transport retry (Phase 7 remediation): the real transport retries
 * only TRANSIENT provider failures — 5xx / UNAVAILABLE / overloaded / network
 * / timeout — with exponential backoff (500ms, 1000ms). Quota (429) and auth
 * (401/403) failures are never retried; they are classified and surfaced so
 * the UI can show the correct honest state (fallback / reconfigure).
 *
 * Bounded: at most GEMINI_MAX_ATTEMPTS attempts and a wall-clock budget of
 * ~65s (an attempt is only started if it can still fit inside the budget).
 */
export const GEMINI_MAX_ATTEMPTS = 3;
export const GEMINI_RETRY_BASE_DELAY_MS = 500;
export const GEMINI_RETRY_DEADLINE_MS = 65_000;

const TRANSIENT_HINTS: readonly string[] = [
  "500", "502", "503", "504", "unavailable", "overloaded", "high demand",
  "internal", "fetch failed", "network", "econnreset", "econnrefused",
  "etimedout", "socket", "timeout",
];

const NON_RETRYABLE_HINTS: readonly string[] = [
  "429", "quota", "resource_exhausted", "401", "403", "permission_denied",
  "api key", "api_key_invalid",
];

/** True only for transient transport/provider failures worth retrying. */
export function isTransientProviderError(error: unknown): boolean {
  // Bounded-field inspection, same shape as classifyProviderError: never
  // stringify a whole unknown error object.
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
  const text = parts.join(" ").toLowerCase().slice(0, 300);
  if (NON_RETRYABLE_HINTS.some((hint) => text.includes(hint))) return false;
  return TRANSIENT_HINTS.some((hint) => text.includes(hint));
}

export type BackoffOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  /** Injectable for deterministic tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Predicate decides whether `error` is worth another attempt. */
  shouldRetry?: (error: unknown) => boolean;
};

/**
 * Run `fn` with bounded exponential backoff. Pure control flow (no clock by
 * default beyond the injected sleep) so tests stay deterministic.
 */
export async function withBoundedBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  options: BackoffOptions = {},
): Promise<T> {
  const {
    maxAttempts = GEMINI_MAX_ATTEMPTS,
    baseDelayMs = GEMINI_RETRY_BASE_DELAY_MS,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    shouldRetry = isTransientProviderError,
  } = options;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      await sleep(baseDelayMs * 2 ** (attempt - 2));
    }
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      // Predicate runs on every failure (even the last attempt) so callers
      // can log; the loop still stops once attempts are exhausted.
      if (!shouldRetry(error) || attempt >= maxAttempts) break;
    }
  }
  throw lastError;
}

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

/** Real transport over @google/genai: hard per-attempt timeout + bounded backoff. */
export function createGeminiTransport(apiKey: string): ModelTransport {
  const ai = new GoogleGenAI({ apiKey });

  return {
    async generate(args: ModelGenerateArgs): Promise<ModelGenerateResult> {
      const startedAt = Date.now();
      return withBoundedBackoff(
        async () => {
          const timeout = new Promise<never>((_, reject) => {
            const timer = setTimeout(
              () => reject(new Error(`provider timeout after ${PROVIDER_TIMEOUT_MS}ms`)),
              PROVIDER_TIMEOUT_MS,
            );
            // Do not hold the event loop open after the race settles.
            (timer as unknown as { unref?: () => void }).unref?.();
          });
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
        // Map at the part level: the SDK's `functionCalls` convenience getter
        // drops the part-level thoughtSignature that Gemini 3 requires to be
        // echoed back on follow-up rounds (round 2 would otherwise 400).
        const parts = response.candidates?.[0]?.content?.parts ?? [];
        let text: string | undefined;
        let textThoughtSignature: string | undefined;
        const functionCalls: ModelFunctionCall[] = [];
        for (const part of parts) {
          if (part.functionCall) {
            functionCalls.push({
              name: part.functionCall.name ?? "",
              args: part.functionCall.args as Record<string, unknown> | undefined,
              id: part.functionCall.id ?? undefined,
              thoughtSignature: part.thoughtSignature,
            });
          } else if (typeof part.text === "string") {
            text = (text ?? "") + part.text;
            if (part.thoughtSignature) textThoughtSignature = part.thoughtSignature;
          }
        }
        return { functionCalls, text, textThoughtSignature };
      })();

        return Promise.race([call, timeout]);
        },
        {
          // Only start another attempt when the failure is transient AND a
          // full attempt can still fit inside the wall-clock budget — bounded
          // at GEMINI_RETRY_DEADLINE_MS total, never unbounded retrying.
          shouldRetry: (error) => {
            const transient = isTransientProviderError(error);
            const message =
              error instanceof Error ? `${error.name}: ${error.message}` : String(typeof error);
            // Sanitized ops log: error name/message only — never the key.
            console.error(
              `[ai/gemini] generate attempt failed (transient=${transient}):`,
              message.slice(0, 200),
            );
            return (
              transient &&
              Date.now() - startedAt <= GEMINI_RETRY_DEADLINE_MS - PROVIDER_TIMEOUT_MS
            );
          },
        },
      );
    },
  };
}
