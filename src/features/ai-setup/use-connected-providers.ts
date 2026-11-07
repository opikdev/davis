import { useEffect, useState } from "react"

import { getConnectedProviders } from "@/features/ai-setup/api"
import { providerById, type Provider } from "@/features/ai-setup/catalog"

export function useConnectedProviders() {
  const [providers, setProviders] = useState<Provider[]>()

  useEffect(() => {
    let isCurrent = true

    getConnectedProviders().then(
      (ids) => {
        if (!isCurrent) return
        setProviders(
          ids.flatMap((id) => {
            const provider = providerById(id)
            return provider ? [provider] : []
          })
        )
      },
      (error: unknown) => {
        console.error("Could not read connected AIs", error)
        if (isCurrent) setProviders([])
      }
    )

    return () => {
      isCurrent = false
    }
  }, [])

  return providers
}
