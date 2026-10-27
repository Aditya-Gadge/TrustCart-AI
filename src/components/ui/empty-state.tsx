import type { ReactNode } from "react";
import { IconInbox } from "@/components/ui/icons";

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong bg-surface px-6 py-14 text-center">
      <span className="rounded-full bg-primary-soft p-3 text-primary [&>svg]:h-6 [&>svg]:w-6">
        {icon ?? <IconInbox />}
      </span>
      <p className="mt-1 text-sm font-semibold">{title}</p>
      <p className="max-w-sm text-sm text-muted">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
