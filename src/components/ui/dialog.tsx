"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { IconClose } from "@/components/ui/icons";

/**
 * Thin wrapper around the native <dialog> element: correct focus,
 * Escape-to-close, and modal semantics for free; backdrop click closes.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e: Event) => {
      if (e.target === el) onClose(); // native "cancel" or backdrop click
    };
    el.addEventListener("close", handler);
    el.addEventListener("cancel", handler);
    const click = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const inside =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (!inside && el.open) onClose();
    };
    el.addEventListener("click", click);
    return () => {
      el.removeEventListener("close", handler);
      el.removeEventListener("cancel", handler);
      el.removeEventListener("click", click);
    };
  }, [onClose]);

  const titleId = `dialog-title-${title.replace(/\W+/g, "-").toLowerCase()}`;

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`m-auto w-[min(92vw,480px)] rounded-lg border border-line bg-surface p-0 text-left shadow-xl backdrop:bg-foreground/30 ${className}`}
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div>
          <h2 id={titleId} className="text-sm font-semibold">
            {title}
          </h2>
          {description ? (
            <p className="mt-0.5 text-xs text-muted">{description}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="rounded-md p-1.5 text-muted hover:bg-background hover:text-foreground"
        >
          <IconClose className="h-4 w-4" />
        </button>
      </div>
      <div className="px-5 py-4">{children}</div>
    </dialog>
  );
}
