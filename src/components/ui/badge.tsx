import type { ReactNode } from "react";
import type { ReviewStatus, RiskBand } from "@/lib/demo/demo-data";
import { REVIEW_STATUS_LABEL, RISK_BAND_LABEL } from "@/lib/demo/demo-data";

export type BadgeTone =
  | "neutral"
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "info";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-background text-muted border-line",
  primary: "bg-primary-soft text-primary border-primary/20",
  success: "bg-success-soft text-success border-success/20",
  warning: "bg-warning-soft text-warning border-warning/25",
  danger: "bg-danger-soft text-danger border-danger/25",
  info: "bg-info-soft text-info border-info/20",
};

export function Badge({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Review-status badge with semantic tone mapping (shared across pages). */
export function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  const tone: Record<ReviewStatus, BadgeTone> = {
    PENDING: "info",
    APPROVED: "success",
    HELD_FOR_REVIEW: "warning",
  };
  return <Badge tone={tone[status]}>{REVIEW_STATUS_LABEL[status]}</Badge>;
}

/** Compact numeric risk chip with qualitative band label. */
export function RiskBadge({ score, band }: { score: number; band: RiskBand }) {
  const tone: Record<RiskBand, BadgeTone> = {
    LOW: "success",
    MEDIUM: "warning",
    HIGH: "danger",
  };
  return (
    <Badge tone={tone[band]}>
      {score} · {RISK_BAND_LABEL[band]}
    </Badge>
  );
}
