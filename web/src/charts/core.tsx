import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  if (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step);
  return ticks;
}

export function ChartTooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(160);
  useLayoutEffect(() => {
    if (ref.current) setW(ref.current.offsetWidth);
  });
  const left = Math.max(0, Math.min(x - w / 2, width - w));
  return (
    <div
      ref={ref}
      role="status"
      className="tooltip pointer-events-none absolute z-10 whitespace-nowrap"
      style={{ left, top: y, transform: "translateY(-100%)" }}
    >
      {children}
    </div>
  );
}

export function TooltipRow({ value, label, color }: { value: ReactNode; label: ReactNode; color?: string }) {
  return (
    <div className="flex items-center gap-2">
      {color && <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: color }} />}
      <span className="tabular font-semibold">{value}</span>
      <span className="font-normal text-on-standout-secondary">{label}</span>
    </div>
  );
}
