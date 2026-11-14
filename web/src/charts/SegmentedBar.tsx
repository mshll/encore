import { useState } from "react";
import { ChartTooltip, useWidth } from "./core";

export type Segment = { id: string; label: string; value: number; color: string; ink: string };

export function SegmentedBar({ segments, label, format }: { segments: Segment[]; label: string; format: (v: number, share: number) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<string | null>(null);
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const visible = segments.filter((s) => s.value > 0);
  const gap = 2;
  const usable = width - gap * (visible.length - 1);
  let x = 0;
  const parts = visible.map((s) => {
    const w = (s.value / total) * usable;
    const part = { ...s, x, w, share: s.value / total };
    x += w + gap;
    return part;
  });
  const hovered = parts.find((p) => p.id === active);
  return (
    <div
      ref={ref}
      className="relative h-7 w-full"
      role="img"
      aria-label={`${label}: ${segments.map((s) => `${s.label} ${format(s.value, s.value / total)}`).join(", ")}`}
    >
      {parts.map((p) => (
        <div
          key={p.id}
          onPointerEnter={() => setActive(p.id)}
          onPointerLeave={() => setActive(null)}
          className="absolute top-0 flex h-7 items-center overflow-hidden rounded-sm px-2 text-caption-lg font-semibold tabular"
          style={{ left: p.x, width: p.w, background: p.color, color: p.ink }}
        >
          {p.w > 44 && `${Math.round(p.share * 100)}%`}
        </div>
      ))}
      {hovered && (
        <ChartTooltip x={hovered.x + hovered.w / 2} y={-6} width={width}>
          <div className="tabular font-semibold">{format(hovered.value, hovered.share)}</div>
          <div className="font-normal text-on-standout-secondary">{hovered.label}</div>
        </ChartTooltip>
      )}
    </div>
  );
}
