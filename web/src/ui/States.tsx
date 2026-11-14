import type { ReactNode } from "react";
import { ApiError } from "../api/client";
import { AppLink } from "./AppLink";
import { Button, buttonClass } from "./Button";
import { cx } from "./cx";
import { Icon, type IconGlyph } from "./Icon";

type Size = "page" | "section" | "inline";

const PAD: Record<Size, string> = { page: "py-24", section: "py-12", inline: "py-4" };

/**
 * What a blank region means and what to do next. One icon, a title, one sentence.
 * Render order in every data region: error, then loading, then empty, then data.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  size = "section",
  className,
}: {
  icon?: IconGlyph;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  size?: Size;
  className?: string;
}) {
  const centred = size !== "inline";
  return (
    <div className={cx("flex flex-col gap-3", centred ? "items-center text-center" : "items-start", PAD[size], className)}>
      {icon && centred && <Icon icon={icon} size="md" className="text-tertiary" />}
      <div className="flex max-w-sm flex-col gap-1">
        <p className="font-medium text-primary">{title}</p>
        {description && <p className="text-secondary text-pretty">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "http_error") return `The server answered ${error.status}.`;
    return error.message;
  }
  if (error instanceof TypeError) return "encore did not answer. Check that the server is running.";
  return error instanceof Error ? error.message : "Something went wrong.";
}

/** A failed load. Always a headline; Try again re-runs the query, never reloads the page. */
export function ErrorState({
  error,
  onRetry,
  title = "Could not load this",
  size = "section",
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  size?: Size;
  className?: string;
}) {
  const centred = size !== "inline";
  return (
    <div role="alert" className={cx("flex flex-col gap-3", centred ? "items-center text-center" : "items-start", PAD[size], className)}>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="font-medium text-primary">{title}</p>
        <p className="text-secondary text-pretty">{describeError(error)}</p>
      </div>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Before any play is imported: what this surface will show, and the one step that gets there. */
export function FirstUseState({ icon, title = "No listening yet", description }: { icon: IconGlyph; title?: string; description: string }) {
  return (
    <EmptyState
      size="page"
      icon={icon}
      title={title}
      description={description}
      action={
        <AppLink to="/setup" className={buttonClass({ variant: "primary" })}>
          Set up encore
        </AppLink>
      }
    />
  );
}
