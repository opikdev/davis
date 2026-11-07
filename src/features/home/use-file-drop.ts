import { getCurrentWebview } from "@tauri-apps/api/webview"
import { useEffect, useRef, useState } from "react"

export function useFileDrop(onDrop: (paths: string[]) => void) {
  const [isDragging, setIsDragging] = useState(false)
  const latestOnDrop = useRef(onDrop)

  useEffect(() => {
    latestOnDrop.current = onDrop
  })

  useEffect(() => {
    let isCurrent = true
    let stopListening: (() => void) | undefined

    getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (payload.type === "enter" || payload.type === "over") {
          setIsDragging(true)
          return
        }
        setIsDragging(false)
        if (payload.type === "drop") latestOnDrop.current(payload.paths)
      })
      .then(
        (unlisten) => {
          if (isCurrent) stopListening = unlisten
          else unlisten()
        },
        (error: unknown) => console.error("Could not watch for drops", error)
      )

    return () => {
      isCurrent = false
      stopListening?.()
    }
  }, [])

  return isDragging
}
