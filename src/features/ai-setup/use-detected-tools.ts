import { useCallback, useEffect, useRef, useState } from "react"

import { detectAiTools, type DetectedTools } from "@/features/ai-setup/api"

const NOTHING_DETECTED: DetectedTools = {
  os: "",
  apps: [],
  localServers: [],
  hasNpm: false,
}

export function useDetectedTools() {
  const [tools, setTools] = useState<DetectedTools>()
  const latestRequest = useRef(0)

  const refresh = useCallback(async () => {
    latestRequest.current += 1
    const request = latestRequest.current
    const detected = await detectAiTools()
    if (request === latestRequest.current) setTools(detected)
    return detected
  }, [])

  useEffect(() => {
    function refreshInBackground() {
      refresh().catch((error: unknown) => {
        console.error("Could not check for AI tools", error)
        setTools((current) => current ?? NOTHING_DETECTED)
      })
    }

    refreshInBackground()
    window.addEventListener("focus", refreshInBackground)
    return () => window.removeEventListener("focus", refreshInBackground)
  }, [refresh])

  return {
    tools: tools ?? NOTHING_DETECTED,
    isDetecting: tools === undefined,
    refresh,
  }
}
