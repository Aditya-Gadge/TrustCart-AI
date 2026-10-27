import { PageHeader } from "@/components/ui/page-header";
import { OverviewDashboard } from "@/components/dashboard/overview-dashboard";

export default function OverviewPage() {
  return (
    <div>
      <PageHeader
        title="Overview"
        description="Daily pulse of your storefront: order volume, review queue pressure, and net sales."
      />
      <OverviewDashboard />
    </div>
  );
}
