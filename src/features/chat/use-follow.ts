import { useCallback, useRef, useState } from "react"

const AT_END_TOLERANCE = 8

function isAtEnd(box: HTMLElement) {
  return box.scrollHeight - box.scrollTop - box.clientHeight <= AT_END_TOLERANCE
}

// Only someone moving up stops the follow. Content changing height must not,
// so an upward move counts only when the height stayed the same.
export function useFollow() {
  const box = useRef<HTMLDivElement | null>(null)
  const [isFollowing, setIsFollowing] = useState(true)
  const following = useRef(true)
  const last = useRef({ top: 0, height: 0 })

  const setFollowing = useCallback((next: boolean) => {
    following.current = next
    setIsFollowing(next)
  }, [])

  const remember = useCallback((node: HTMLElement) => {
    last.current = { top: node.scrollTop, height: node.scrollHeight }
  }, [])

  const toEnd = useCallback(() => {
    const node = box.current
    if (!node) return
    node.scrollTop = node.scrollHeight
    remember(node)
  }, [remember])

  const jumpToEnd = useCallback(() => {
    setFollowing(true)
    toEnd()
  }, [setFollowing, toEnd])

  const onScroll = useCallback(() => {
    const node = box.current
    if (!node) return
    const { top, height } = last.current
    if (isAtEnd(node)) setFollowing(true)
    else if (node.scrollTop < top && node.scrollHeight === height) {
      setFollowing(false)
    }
    remember(node)
  }, [remember, setFollowing])

  const onWheel = useCallback(
    (event: React.WheelEvent) => {
      if (event.deltaY < 0 && box.current?.scrollTop) setFollowing(false)
    },
    [setFollowing]
  )

  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      box.current = node
      const content = node?.firstElementChild
      if (!content) return
      const observer = new ResizeObserver(() => {
        if (following.current) toEnd()
      })
      observer.observe(content)
      return () => observer.disconnect()
    },
    [toEnd]
  )

  return { attach, isFollowing, jumpToEnd, onScroll, onWheel }
}
