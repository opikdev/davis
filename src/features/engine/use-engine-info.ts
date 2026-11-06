import { useCallback, useEffect, useState } from "react"

import { getEngineInfo, type EngineInfo } from "@/features/engine/api"
import { toErrorMessage } from "@/lib/ipc-error"

type EngineState =
  | { status: "loading" }
  | { status: "ready"; info: EngineInfo }
  | { status: "error"; message: string }

export function useEngineInfo() {
  const [state, setState] = useState<EngineState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let isCurrent = true

    getEngineInfo().then(
      (info) => {
        if (isCurrent) setState({ status: "ready", info })
      },
      (error: unknown) => {
        if (isCurrent) {
          setState({ status: "error", message: toErrorMessage(error) })
        }
      }
    )

    return () => {
      isCurrent = false
    }
  }, [attempt])

  const retry = useCallback(() => {
    setState({ status: "loading" })
    setAttempt((current) => current + 1)
  }, [])

  return { state, retry }
}
