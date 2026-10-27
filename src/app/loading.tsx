import { TableSkeleton, KpiSkeleton } from "@/components/ui/skeleton";

/**
 * Route-level loading state (Phase 6): a labelled skeleton while server
 * components stream — consistent with the in-component loading states.
 */
export default function RouteLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading page content">
      <KpiSkeleton />
      <TableSkeleton rows={6} />
    </div>
  );
}
