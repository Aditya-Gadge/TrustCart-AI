import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBanner } from "@/components/ui/demo-banner";
import { Badge } from "@/components/ui/badge";
import { DEMO_MERCHANT } from "@/lib/demo/demo-data";

export const metadata: Metadata = {
  title: "Settings",
};

/**
 * Display-only settings: a clearly synthetic merchant card and environment
 * status. Interactive settings would require an authentication layer, which
 * is out of demo scope — no toggles that pretend to persist.
 */
export default function SettingsPage() {
  return (
    <div>
      <PageHeader
        title="Settings"
        description="Environment and merchant information for the demo build."
      />
      <DemoBanner>
        Profile and preference management are out of demo scope (no
        authentication layer). Values below are fixed demo placeholders and
        intentionally read-only.
      </DemoBanner>

      <div className="grid gap-4 lg:grid-cols-2">
        <section
          aria-label="Merchant profile"
          className="rounded-lg border border-line bg-surface p-5"
        >
          <h2 className="text-sm font-semibold">Merchant profile</h2>
          <dl className="mt-3 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Store name</dt>
              <dd className="text-right font-medium">{DEMO_MERCHANT.name}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Merchant reference</dt>
              <dd className="text-right font-medium tabular-nums">
                {DEMO_MERCHANT.merchantLabel}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Region</dt>
              <dd className="text-right font-medium">
                {DEMO_MERCHANT.regionLabel}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Payout currency</dt>
              <dd className="text-right font-medium">
                {DEMO_MERCHANT.currencyLabel}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-muted">
            Synthetic merchant identity — contains no real customer or business
            information.
          </p>
        </section>

        <section
          aria-label="Environment status"
          className="rounded-lg border border-line bg-surface p-5"
        >
          <h2 className="text-sm font-semibold">Environment status</h2>
          <ul role="list" className="mt-3 space-y-2">
            {DEMO_MERCHANT.notes.map((note) => (
              <li
                key={note.label}
                className="flex items-center justify-between gap-3 rounded-md border border-line bg-background px-3 py-2 text-xs"
              >
                <span className="text-muted">{note.label}</span>
                <Badge tone={note.active ? "success" : "neutral"}>
                  {note.active ? "Active" : "Not configured"}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
