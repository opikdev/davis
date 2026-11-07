import { useCallback, useEffect, useState } from "react"

import {
  chooseModel,
  getChosenModel,
  type ChosenModel,
} from "@/features/ai-setup/api"

export function useChosenModel() {
  const [chosen, setChosen] = useState<ChosenModel | null>(null)
  const [hasLoaded, setHasLoaded] = useState(false)

  useEffect(() => {
    let isCurrent = true

    getChosenModel().then(
      (saved) => {
        if (!isCurrent) return
        setChosen((latest) => latest ?? saved)
        setHasLoaded(true)
      },
      (error: unknown) => {
        console.error("Could not read the model", error)
        if (isCurrent) setHasLoaded(true)
      }
    )

    return () => {
      isCurrent = false
    }
  }, [])

  const choose = useCallback((choice: ChosenModel) => {
    setChosen(choice)
    chooseModel(choice).catch((error: unknown) =>
      console.error("Could not save the model", error)
    )
  }, [])

  return { chosen, choose, hasLoaded }
}
