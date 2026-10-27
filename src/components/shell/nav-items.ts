import type { ComponentType, SVGProps } from "react";
import {
  IconCopilot,
  IconInvestigations,
  IconOrders,
  IconOverview,
  IconSettings,
} from "@/components/ui/icons";

export type NavItem = {
  href: string;
  label: string;
  step: string; // honest roadmap placement for the demo
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Overview", step: "Phase 1", Icon: IconOverview },
  { href: "/orders", label: "Orders", step: "Phase 1", Icon: IconOrders },
  {
    href: "/investigations",
    label: "Investigations",
    step: "Phase 3 deepens",
    Icon: IconInvestigations,
  },
  { href: "/copilot", label: "AI Copilot", step: "Phase 4", Icon: IconCopilot },
  { href: "/settings", label: "Settings", step: "Phase 1", Icon: IconSettings },
];
