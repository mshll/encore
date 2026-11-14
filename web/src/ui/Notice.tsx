import type { ReactNode } from "react";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { InfoIcon, WarningIcon } from "./icons";

export type NoticeTone = "info" | "warning" | "danger";

const TONE: Record<NoticeTone, string> = {
  info: "bg-fill text-primary",
  warning: "bg-warning-subtle text-warning",
  danger: "bg-danger-subtle text-danger",
};

/** A sentence about the state of this page that the user should act on or know before acting. */
export function Notice({ tone = "info", children, action, className }: { tone?: NoticeTone; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("flex items-start gap-2.5 rounded-lg px-3 py-2.5 phone:-mx-(--gutter) phone:rounded-none phone:px-(--gutter)", TONE[tone], className)}>
      <Icon icon={tone === "info" ? InfoIcon : WarningIcon} className="mt-px" />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2 text-pretty md:flex-row md:items-center md:justify-between">
        <p className="min-w-0">{children}</p>
        {action && <div className="flex shrink-0 gap-2 phone:-ml-0.5">{action}</div>}
      </div>
    </div>
  );
}
