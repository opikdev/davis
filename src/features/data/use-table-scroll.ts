import { useCallback, useEffect, useRef, useState } from "react"

const LINE_PIXELS = 16

type Limits = { maxX: number; maxY: number }

function clamp(value: number, max: number) {
  return Math.min(Math.max(value, 0), Math.max(max, 0))
}

// The table scrolls itself: native scrolling proved unreliable in the macOS
// webview, and browsers cap element height well below what large files need.
export function useTableScroll(
  element: React.RefObject<HTMLElement | null>,
  { maxX, maxY }: Limits
) {
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const latest = useRef(position)
  const limits = useRef({ maxX, maxY })
  const frame = useRef(0)

  useEffect(() => {
    limits.current = { maxX, maxY }
  }, [maxX, maxY])

  const moveTo = useCallback((x: number, y: number) => {
    latest.current = {
      x: clamp(x, limits.current.maxX),
      y: clamp(y, limits.current.maxY),
    }
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      setPosition(latest.current)
    })
  }, [])

  const moveBy = useCallback(
    (x: number, y: number) =>
      moveTo(latest.current.x + x, latest.current.y + y),
    [moveTo]
  )

  useEffect(() => {
    const target = element.current
    if (!target) return

    function scrollOnWheel(event: WheelEvent) {
      event.preventDefault()
      const scale =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? LINE_PIXELS
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? (target?.clientHeight ?? 0)
            : 1
      const [x, y] =
        event.shiftKey && event.deltaX === 0
          ? [event.deltaY, 0]
          : [event.deltaX, event.deltaY]
      moveBy(x * scale, y * scale)
    }

    target.addEventListener("wheel", scrollOnWheel, { passive: false })
    return () => {
      target.removeEventListener("wheel", scrollOnWheel)
      cancelAnimationFrame(frame.current)
      frame.current = 0
    }
  }, [element, moveBy])

  return { position, moveTo, moveBy }
}
