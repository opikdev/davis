import { useCallback, useEffect, useState } from "react"

import {
  chooseModel,
  getChosenModel,
  type ChosenModel,
} from "@/features/ai-setup/api"

export function useChosenModel() {
  const [chosen, setChosen] = useState<ChosenModel | null>(null)

  useEffect(() => {
    let isCurrent = true

    getChosenModel().then(
      (saved) => {
        if (isCurrent) setChosen((latest) => latest ?? saved)
      },
      (error: unknown) => console.error("Could not read the model", error)
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

  return [chosen, choose] as const
}
