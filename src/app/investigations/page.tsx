import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { ReviewQueue } from "@/components/investigations/review-queue";

export const metadata: Metadata = {
  title: "Investigations",
};

export default function InvestigationsPage() {
  return (
    <div>
      <PageHeader
        title="Investigations"
        description="The review queue: held orders plus pending high-risk orders, highest risk first, straight from the database."
      />
      <ReviewQueue />
      <p className="mt-6 text-xs text-muted">
        Risk scores come from the deterministic demo-heuristic engine (rules version stamped on
        every order). Open an order to see the exact evidence behind every reason and to record a
        review decision.
      </p>
    </div>
  );
}
