"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  ACTION_LABEL,
  ALLOWED_TRANSITIONS,
  TARGET_STATUS,
  type OrderStatusKey,
  type ReviewAction,
} from "@/lib/review/transitions";

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "conflict" }
  | { kind: "error"; message: string }
  | { kind: "success"; toStatus: OrderStatusKey };

/**
 * Merchant review actions (Phase 3). Every consequential action requires an
 * explicit confirmation dialog AND a reason (min 4 chars, re-validated
 * server-side). Optimistic concurrency: the dialog submits the `updatedAt`
 * the page was rendered with; if another update landed first the server
 * returns 409 and we refresh instead of overwriting.
 */
export function ReviewActions({
  orderId,
  orderNumber,
  status,
  updatedAt,
}: {
  orderId: string;
  orderNumber: string;
  status: OrderStatusKey;
  updatedAt: string;
}) {
  const router = useRouter();
  const [activeAction, setActiveAction] = useState<ReviewAction | null>(null);
  const [reason, setReason] = useState("");
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  const allowed = ALLOWED_TRANSITIONS[status];
  const busy = state.kind === "submitting";

  function closeDialog() {
    if (busy) return;
    setActiveAction(null);
    setReason("");
  }

  async function submit() {
    if (!activeAction) return;
    if (reason.trim().length < 4) {
      reasonRef.current?.focus();
      return;
    }
    setState({ kind: "submitting" });
    try {
      const res = await fetch(`/api/orders/${orderId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: activeAction,
          reason: reason.trim(),
          expectedUpdatedAt: updatedAt,
        }),
      });
      if (res.status === 409) {
        setState({ kind: "conflict" });
        router.refresh(); // re-render with the fresh updatedAt
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        // Refresh FIRST so the page shows the server's current status — the
        // stale render is what caused the rejection (e.g. invalid_transition).
        router.refresh();
        setState({
          kind: "error",
          message:
            body?.error === "invalid_transition"
              ? "That decision no longer matches the order's current status — the page has been refreshed."
              : body?.error === "invalid_payload"
                ? "The server rejected the payload — a reason of at least 4 characters is required."
                : "The review service is unavailable right now. Try again shortly.",
        });
        return;
      }
      const body = (await res.json()) as { toStatus: OrderStatusKey };
      setState({ kind: "success", toStatus: body.toStatus });
      setActiveAction(null);
      setReason("");
      router.refresh();
    } catch {
      setState({
        kind: "error",
        message: "Network error while recording the decision. Try again.",
      });
    }
  }

  if (allowed.length === 0) {
    return (
      <p className="text-sm text-muted">No review actions available for this status.</p>
    );
  }

  return (
    <div>
      {state.kind === "success" ? (
        <p className="mb-3 rounded-md bg-success-soft px-3 py-2 text-xs text-success" role="status">
          Decision recorded — status is now {state.toStatus.replace(/_/g, " ").toLowerCase()}. The
          decision and audit entry are persisted.
        </p>
      ) : null}
      {state.kind === "conflict" ? (
        <p className="mb-3 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning" role="alert">
          This order changed while you were working (409 conflict). The page has been refreshed with
          the latest state — review it and try again. Nothing was overwritten.
        </p>
      ) : null}
      {state.kind === "error" ? (
        <p className="mb-3 rounded-md bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">
          {state.message}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {allowed.map((action) => (
          <Button
            key={action}
            variant={action === "APPROVE" ? "primary" : "secondary"}
            size="sm"
            disabled={busy}
            onClick={() => {
              setState({ kind: "idle" });
              setActiveAction(action);
            }}
          >
            {ACTION_LABEL[action]}
          </Button>
        ))}
      </div>

      <Dialog
        open={activeAction !== null}
        onClose={closeDialog}
        title={activeAction ? `${ACTION_LABEL[activeAction]} — ${orderNumber}` : ""}
        description="This records a review decision and an audit event. A reason is required."
      >
        {activeAction ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <p className="text-sm text-muted">
              Status change:{" "}
              <span className="font-medium text-foreground">
                {status.replace(/_/g, " ")} → {TARGET_STATUS[activeAction].replace(/_/g, " ")}
              </span>
            </p>
            <label htmlFor="review-reason" className="mt-3 block text-sm font-medium">
              Reason <span className="text-danger">*</span>
            </label>
            <textarea
              id="review-reason"
              ref={reasonRef}
              required
              minLength={4}
              maxLength={280}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Documented why this decision is being made (required)…"
              className="mt-1 w-full rounded-md border border-line bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
            <p className="mt-1 text-xs text-muted">
              {reason.trim().length}/280 · stored with the decision and shown in the audit trail.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={closeDialog} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={busy || reason.trim().length < 4}>
                {busy ? "Recording…" : `Confirm ${ACTION_LABEL[activeAction].toLowerCase()}`}
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </div>
  );
}
