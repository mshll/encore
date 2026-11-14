import type { CSSProperties, ReactNode } from "react";
import { ApiError } from "../api/client";

export function Skeleton({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden className={`skeleton ${className}`} style={style} />;
}

export function SkeletonRows({ rows = 6, className = "" }: { rows?: number; className?: string }) {
  return (
    <div aria-hidden className={`flex flex-col ${className}`}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-14 items-center gap-3">
          <Skeleton className="size-11 rounded-md md:size-10" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-3.5 w-12" />
        </div>
      ))}
    </div>
  );
}

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0 || error.code === "http_error") return `The server answered ${error.status}. ${error.message}`;
    return error.message;
  }
  if (error instanceof TypeError) return "Could not reach the server. Check that it is running, then try again.";
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function ErrorState({ error, onRetry, title = "Could not load this" }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 py-6">
      <div className="flex flex-col gap-1">
        <p className="font-medium text-primary">{title}</p>
        <p className="text-secondary">{describe(error)}</p>
      </div>
      {onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-6">
      <p className="font-medium text-primary">{title}</p>
      {children && <div className="text-secondary">{children}</div>}
    </div>
  );
}
