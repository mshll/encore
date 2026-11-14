import type { ComponentProps } from "react";
import { Link, useSearchParams } from "wouter";
import { rangeSearch } from "../lib/range";

/** Builds hrefs that keep the current date range, so moving between surfaces keeps the scope. */
export function useRangeHref() {
  const [params] = useSearchParams();
  const search = rangeSearch({ from: params.get("from") ?? undefined, to: params.get("to") ?? undefined });
  return (path: string) => {
    if (!search) return path;
    return path.includes("?") ? `${path}&${search.slice(1)}` : `${path}${search}`;
  };
}

export function AppLink({ to, ...props }: { to: string } & Omit<ComponentProps<"a">, "href">) {
  const href = useRangeHref();
  return <Link href={href(to)} {...props} />;
}
