import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

export type Column<T> = {
  key: string;
  header: string;
  numeric?: boolean;
  className?: string;
  render: (row: T) => ReactNode;
};

type DataTableProps<T> = {
  columns: Column<T>[];
  rows: readonly T[];
  caption: string;
  empty?: { title: string; description: string; action?: ReactNode };
  loadingRows?: number; // renders skeleton rows when provided
};

/**
 * Accessible, reusable data table: semantic <table>, scope'd headers,
 * right-aligned tabular-numeric columns, horizontal scroll wrapper for
 * narrow screens, and built-in empty/loading presentations.
 */
export function DataTable<T extends { id: string }>({
  columns,
  rows,
  caption,
  empty,
  loadingRows,
}: DataTableProps<T>) {
  if (loadingRows) {
    return <TableRowsSkeleton columns={columns.length} rows={loadingRows} />;
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title={empty?.title ?? "Nothing to show"}
        description={empty?.description ?? "No rows match the current filters."}
        action={empty?.action}
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line bg-background/60">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted ${
                  c.numeric ? "text-right" : "text-left"
                } ${c.className ?? ""}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-line/70 transition-colors last:border-b-0 hover:bg-background/70"
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-4 py-3 align-middle ${
                    c.numeric ? "text-right tabular-nums" : ""
                  } ${c.className ?? ""}`}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableRowsSkeleton({
  columns,
  rows,
}: {
  columns: number;
  rows: number;
}) {
  return (
    <div
      className="rounded-lg border border-line bg-surface"
      aria-hidden="true"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-line px-4 py-3 last:border-b-0"
        >
          {Array.from({ length: columns }).map((__, j) => (
            <Skeleton
              key={j}
              className={`h-4 ${j === 0 ? "w-20" : "w-24 max-w-32"}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
