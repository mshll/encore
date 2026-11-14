import type { ReactNode } from "react";

export type LegendItem = { id: string; label: string; color: string; detail?: ReactNode };

export function Legend({ items, active, onToggle }: { items: LegendItem[]; active?: string | null; onToggle?: (id: string) => void }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1">
      {items.map((item) => {
        const content = (
          <>
            <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: item.color }} />
            <span className="truncate">{item.label}</span>
            {item.detail && <span className="text-secondary tabular">{item.detail}</span>}
          </>
        );
        return (
          <li key={item.id} className="min-w-0">
            {onToggle ? (
              <button
                type="button"
                aria-pressed={active === item.id}
                onClick={() => onToggle(item.id)}
                className={`flex h-11 max-w-full items-center gap-2 text-body-sm transition-opacity duration-150 md:h-8 ${active && active !== item.id ? "opacity-50" : ""}`}
              >
                {content}
              </button>
            ) : (
              <span className="flex h-8 items-center gap-2 text-body-sm">{content}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
