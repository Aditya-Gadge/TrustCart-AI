import type { SVGProps } from "react";

/**
 * Minimal inline icon set (stroke, 24×24, currentColor). Zero icon-library
 * dependencies — new icons are added here as small, focused components.
 */

type IconProps = SVGProps<SVGSVGElement>;

function Base({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconOverview(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </Base>
  );
}

export function IconOrders(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M5 3.5h11a2 2 0 0 1 2 2v16l-4-2.4L10 21.5l-3 0" />
      <path d="M5 3.5v18" />
      <path d="M9 8h6M9 12h6" />
    </Base>
  );
}

export function IconInvestigations(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 3 4 6v5c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V6l-8-3Z" />
      <circle cx="12" cy="10" r="2.4" />
      <path d="m16 14-2.2-2.2" />
    </Base>
  );
}

export function IconCopilot(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
      <circle cx="12" cy="12" r="3.5" />
    </Base>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.24.44.75.9 1.56 1H21a2 2 0 1 1 0 4h-.09c-.81.1-1.32.56-1.51 1Z" />
    </Base>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.5-4.5" />
    </Base>
  );
}

export function IconMenu(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Base>
  );
}

export function IconClose(props: IconProps) {
  return (
    <Base {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Base>
  );
}

export function IconChevronLeft(props: IconProps) {
  return (
    <Base {...props}>
      <path d="m14.5 6-6 6 6 6" />
    </Base>
  );
}

export function IconChevronsRight(props: IconProps) {
  return (
    <Base {...props}>
      <path d="m8 6 6 6-6 6" />
      <path d="m13 6 6 6-6 6" opacity="0.4" />
    </Base>
  );
}

export function IconInbox(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 13h4l1.5 3h5L16 13h4" />
      <path d="M6.5 5h11l2.5 8v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4l2.5-8Z" />
    </Base>
  );
}

export function IconAlert(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 4 2.7 20h18.6L12 4Z" />
      <path d="M12 10v4.5" />
      <circle cx="12" cy="17.4" r="0.4" fill="currentColor" />
    </Base>
  );
}

export function IconArrowUp(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 19V5m0 0-5 5m5-5 5 5" />
    </Base>
  );
}

export function IconArrowDown(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 5v14m0 0-5-5m5 5 5-5" />
    </Base>
  );
}

export function LogoMark(props: IconProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" {...props}>
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      <path
        d="M9 10.5h2.2l1 9.5a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.7l.9-5.6h-11"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12.6" cy="24.6" r="1.1" fill="#fff" />
      <circle cx="19.6" cy="24.6" r="1.1" fill="#fff" />
      <path d="m19.2 6.5 1.8 2.4 3.2-3" stroke="#a5b4fc" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
