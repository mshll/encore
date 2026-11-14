import { useEffect, type ReactNode } from "react";
import { RangePicker } from "./RangePicker";

export function Page({
  title,
  docTitle,
  ranged = false,
  actions,
  hero,
  children,
}: {
  title: ReactNode;
  hero?: (controls: ReactNode) => ReactNode;
  docTitle?: string;
  ranged?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const name = docTitle ?? (typeof title === "string" ? title : undefined);
  useEffect(() => {
    document.title = name ? `${name} · encore` : "encore";
  }, [name]);
  return (
    <div className="relative isolate mx-auto flex w-full max-w-[1180px] flex-col gap-10 safe-x pt-[max(20px,env(safe-area-inset-top))] pb-10 md:gap-14 md:px-10 md:pt-10 md:pb-16">
      {hero ? (
        hero(
          <div className="flex flex-wrap items-center justify-center gap-2 md:justify-start">
            {actions}
            {ranged && <RangePicker />}
          </div>,
        )
      ) : (
        <header className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <h1 className="min-w-0 text-heading-4 font-semibold text-pretty md:text-heading-3">{title}</h1>
          {(ranged || actions) && (
            <div className="flex max-w-full items-center gap-2">
              {actions}
              {ranged && <RangePicker />}
            </div>
          )}
        </header>
      )}
      {children}
    </div>
  );
}

export function Section({ title, aside, children, className = "" }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`flex min-w-0 flex-col gap-4 ${className}`}>
      {(title || aside) && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          {title && <h2 className="text-heading-6 font-semibold">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}
