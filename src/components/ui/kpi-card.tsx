import type { ReactNode } from "react";
import { IconArrowDown, IconArrowUp } from "@/components/ui/icons";

export type KpiCardProps = {
  label: string;
  value: string;
  delta?: { text: string; positive: boolean } | null;
  hint?: string;
  icon?: ReactNode;
};

export function KpiCard({ label, value, delta, hint, icon }: KpiCardProps) {
  return (
    <div className="rounded-lg border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted">{label}</p>
        {icon ? (
          <span className="rounded-md bg-primary-soft p-1.5 text-primary [&>svg]:h-4 [&>svg]:w-4">
            {icon}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </p>
      {delta ? (
        <p
          className={`mt-1 inline-flex items-center gap-1 text-xs font-medium tabular-nums ${
            delta.positive ? "text-success" : "text-danger"
          }`}
        >
          {delta.positive ? (
            <IconArrowUp className="h-3.5 w-3.5" />
          ) : (
            <IconArrowDown className="h-3.5 w-3.5" />
          )}
          {delta.text}
        </p>
      ) : null}
      {hint ? <p className="mt-2 text-xs leading-5 text-muted">{hint}</p> : null}
    </div>
  );
}
