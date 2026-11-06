import { useCallback, useEffect, useState } from "react"

import {
  completeOnboarding,
  getOnboardingStatus,
} from "@/features/onboarding/api"

export function useOnboardingStatus() {
  const [isOnboarded, setIsOnboarded] = useState<boolean>()

  useEffect(() => {
    getOnboardingStatus().then(
      ({ isComplete }) => setIsOnboarded(isComplete),
      () => setIsOnboarded(false)
    )
  }, [])

  const finishOnboarding = useCallback(() => {
    setIsOnboarded(true)
    completeOnboarding().catch((error: unknown) => {
      console.error("Could not save onboarding status", error)
    })
  }, [])

  return { isOnboarded, finishOnboarding }
}
