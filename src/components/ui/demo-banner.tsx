import { Badge } from "@/components/ui/badge";

/**
 * Honest-context banner: every Phase 1 page shows where its data comes
 * from, so demo placeholders are never mistaken for live integrations.
 */
export function DemoBanner({ children }: { children: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-info/20 bg-info-soft px-4 py-3 text-sm text-info">
      <Badge tone="info">Demo</Badge>
      <span className="max-w-3xl leading-5">{children}</span>
    </div>
  );
}
