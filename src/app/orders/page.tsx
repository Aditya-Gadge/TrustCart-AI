import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { OrderExplorer } from "@/components/orders/order-explorer";

export const metadata: Metadata = {
  title: "Orders",
};

export default function OrdersPage() {
  return (
    <div>
      <PageHeader
        title="Orders"
        description="Searchable, filterable order list over the PostgreSQL demo dataset, scored by the deterministic risk engine."
      />
      <OrderExplorer />
    </div>
  );
}
