import { useCallback, useEffect, useState } from "react"

import { listModels, type Model } from "@/features/ai-setup/api"

type ModelList = { models: Model[] } | { hasFailed: true }

export function useModels(providerId?: string) {
  const [lists, setLists] = useState<Record<string, ModelList>>({})
  const list = providerId ? lists[providerId] : undefined
  const isMissing = providerId !== undefined && list === undefined

  useEffect(() => {
    if (!isMissing) return
    let isCurrent = true

    listModels(providerId).then(
      (models) => {
        if (isCurrent) {
          setLists((known) => ({ ...known, [providerId]: { models } }))
        }
      },
      (error: unknown) => {
        console.error(`Could not list models for ${providerId}`, error)
        if (isCurrent) {
          setLists((known) => ({ ...known, [providerId]: { hasFailed: true } }))
        }
      }
    )

    return () => {
      isCurrent = false
    }
  }, [providerId, isMissing])

  const retry = useCallback(() => {
    if (!providerId) return
    setLists((known) => {
      const remaining = { ...known }
      delete remaining[providerId]
      return remaining
    })
  }, [providerId])

  function modelsOf(id: string) {
    const known = lists[id]
    return known && "models" in known ? known.models : undefined
  }

  return {
    modelsOf,
    hasFailed: list !== undefined && "hasFailed" in list,
    retry,
  }
}
