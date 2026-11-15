"use client"

import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useLayoutEffect, useRef, useState } from "react"
import { useCommonChart } from "./common-context"
import { rgb } from "./palette"

const GAP = 8

/**
 * Floating hover tooltip. Reads the shared common context so it works in every
 * chart family. It sizes to its content, stays inside the chart, glides between
 * points and fades in/out, and dims unselected series/slices.
 */
export function Tooltip({
  labelKey,
  valueFormatter,
}: {
  labelKey?: string
  valueFormatter?: (value: number, name: string) => string
}) {
  const chart = useCommonChart()
  const reduce = useReducedMotion()
  const show = chart.ready && chart.hoverIndex != null

  // Retain the last hovered index so the card keeps its content while fading
  // out — adjust-state-during-render (no refs in render).
  const [lastIndex, setLastIndex] = useState(0)
  if (chart.hoverIndex != null && chart.hoverIndex !== lastIndex) {
    setLastIndex(chart.hoverIndex)
  }
  const index = chart.hoverIndex ?? lastIndex

  const heading = chart.heading(index, labelKey)
  const items = chart.itemsAt(index)

  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0, bound: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const next = { w: el.offsetWidth, h: el.offsetHeight, bound: el.parentElement?.clientWidth ?? 0 }
    setBox((prev) => (prev.w === next.w && prev.h === next.h && prev.bound === next.bound ? prev : next))
  })
  const left = Math.max(0, Math.min(chart.tooltipLeft - box.w / 2, box.bound - box.w))
  const top = Math.max(0, chart.tooltipTop - box.h - GAP)

  return (
    <AnimatePresence>
      {show && items.length > 0 && (
        <motion.div
          ref={ref}
          key="dither-tooltip"
          initial={{ opacity: 0, top, left }}
          animate={{ opacity: 1, top, left }}
          exit={{ opacity: 0 }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 38, mass: 0.6 }}
          className="pointer-events-none absolute z-10 flex w-max max-w-full flex-col gap-0.5 rounded-lg bg-overlay px-2.5 py-1.5 text-caption shadow-overlay"
        >
          {heading && <div className="truncate text-secondary">{heading}</div>}
          {items.map((item) => (
            <div key={item.name} className="flex min-w-0 items-center gap-1.5" style={{ opacity: item.dimmed ? 0.4 : 1 }}>
              <span aria-hidden className="size-2 shrink-0 rounded-[1px]" style={{ backgroundColor: rgb(item.seed.fill) }} />
              <span className="min-w-0 truncate text-secondary">{item.label}</span>
              <span className="ml-auto shrink-0 pl-3 font-medium whitespace-nowrap text-primary tabular">
                {valueFormatter ? valueFormatter(item.value, item.name) : item.value.toLocaleString()}
              </span>
            </div>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

Tooltip.chartLayer = "dom" as const
