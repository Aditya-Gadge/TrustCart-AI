"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/error-state";

/**
 * Route-level error boundary (Phase 6): uncaught server/render errors show
 * the app's own ErrorState with a retry action instead of the Next.js
 * default screen. The error message is never rendered — it can contain
 * internal details; only the digest is surfaced for support.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Next.js expects client-side error reporting here; the digest keeps it
    // correlatable without exposing internals to the UI.
    console.error("[app/error] route error digest:", error.digest ?? error.message);
  }, [error]);

  return (
    <ErrorState
      title="Something went wrong"
      description={
        error.digest
          ? `The page could not be rendered. Reference: ${error.digest}`
          : "The page could not be rendered."
      }
      retry={{ label: "Try again", onRetry: () => reset() }}
    />
  );
}
