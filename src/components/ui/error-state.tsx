import { IconAlert } from "@/components/ui/icons";

export function ErrorState({
  title = "Something went wrong",
  description,
  retry,
}: {
  title?: string;
  description: string;
  retry?: { label: string; onRetry: () => void };
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-danger/30 bg-danger-soft px-6 py-14 text-center"
    >
      <span className="rounded-full bg-surface p-3 text-danger [&>svg]:h-6 [&>svg]:w-6">
        <IconAlert />
      </span>
      <p className="mt-1 text-sm font-semibold">{title}</p>
      <p className="max-w-sm text-sm text-muted">{description}</p>
      {retry ? (
        <button
          type="button"
          onClick={retry.onRetry}
          className="mt-2 inline-flex h-9 items-center rounded-md border border-danger/30 bg-surface px-4 text-sm font-medium text-danger hover:bg-surface/80"
        >
          {retry.label}
        </button>
      ) : null}
    </div>
  );
}
