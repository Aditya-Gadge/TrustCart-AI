"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { DEMO_MERCHANT } from "@/lib/demo/demo-data";

/**
 * Header profile menu. Informational only (demo merchant identity +
 * phase status) — menu items with no real action are shown disabled
 * rather than pretending to work.
 */
export function ProfileMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Merchant profile menu"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-primary-soft text-xs font-semibold text-primary transition-colors hover:border-primary/40"
      >
        DM
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Merchant profile"
          className="absolute right-0 top-12 w-64 rounded-lg border border-line bg-surface p-3 text-sm shadow-lg"
        >
          <p className="font-semibold">{DEMO_MERCHANT.name}</p>
          <p className="mt-0.5 text-xs text-muted">
            Demo merchant · {DEMO_MERCHANT.merchantLabel}
          </p>
          <div className="my-2 h-px bg-line" />
          <Badge tone="info">All phases · QA-hardened build</Badge>
          <button
            type="button"
            role="menuitem"
            disabled
            title="Account options arrive with real authentication (out of demo scope)"
            className="mt-3 w-full cursor-not-allowed rounded-md border border-line bg-background px-3 py-2 text-left text-xs text-muted"
          >
            Account options — not available in demo
          </button>
        </div>
      ) : null}
    </div>
  );
}
