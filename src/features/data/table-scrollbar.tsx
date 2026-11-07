import { useRef } from "react"

import { cn } from "@/lib/utils"

const MIN_THUMB = 28

type TableScrollbarProps = {
  axis: "x" | "y"
  position: number
  max: number
  viewport: number
  onChange: (position: number) => void
}

export function TableScrollbar({
  axis,
  position,
  max,
  viewport,
  onChange,
}: TableScrollbarProps) {
  const drag = useRef<{ pointer: number; position: number }>(null)
  if (max <= 0 || viewport <= 0) return null

  const isVertical = axis === "y"
  const thumb = Math.max(MIN_THUMB, (viewport * viewport) / (viewport + max))
  const travel = Math.max(viewport - thumb, 1)
  const offset = (position / max) * travel
  const pointerAt = (event: React.PointerEvent) =>
    isVertical ? event.clientY : event.clientX

  return (
    <div
      aria-hidden="true"
      data-axis={axis}
      className={cn(
        "group/bar absolute z-20 opacity-0 transition-opacity duration-200 group-hover/table:opacity-100",
        isVertical
          ? "top-0 right-0 bottom-0 w-2.5"
          : "right-0 bottom-0 left-0 h-2.5"
      )}
      onPointerDown={(event) => {
        const box = event.currentTarget.getBoundingClientRect()
        const start = isVertical ? box.top : box.left
        const target = pointerAt(event) - start - thumb / 2
        onChange((target / travel) * max)
      }}
    >
      <div
        className={cn(
          "absolute rounded-full bg-foreground/20 transition-colors group-hover/bar:bg-foreground/35",
          isVertical ? "right-0.5 w-1.5" : "bottom-0.5 h-1.5"
        )}
        style={
          isVertical
            ? { top: offset, height: thumb }
            : { left: offset, width: thumb }
        }
        onPointerDown={(event) => {
          event.stopPropagation()
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { pointer: pointerAt(event), position }
        }}
        onPointerMove={(event) => {
          if (!drag.current) return
          const moved = pointerAt(event) - drag.current.pointer
          onChange(drag.current.position + (moved / travel) * max)
        }}
        onPointerUp={() => {
          drag.current = null
        }}
      />
    </div>
  )
}
