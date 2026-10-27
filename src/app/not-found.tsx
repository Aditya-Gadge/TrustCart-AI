import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Root 404 (Phase 6): unknown routes (including notFound() calls such as an
 * unknown order id) render the app's own empty-state system with a way back
 * instead of the Next.js default screen.
 */
export default function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      description="This page or order does not exist in the demo dataset."
      action={
        <Link
          href="/orders"
          className="inline-flex h-9 items-center rounded-md border border-line bg-surface px-4 text-sm font-medium hover:bg-background"
        >
          Back to orders
        </Link>
      }
    />
  );
}
