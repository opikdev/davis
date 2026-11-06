import { Workspace } from "@/app/workspace"
import { Onboarding, useOnboardingStatus } from "@/features/onboarding"

export function App() {
  const { isOnboarded, finishOnboarding } = useOnboardingStatus()

  if (isOnboarded === undefined) return null
  if (!isOnboarded) return <Onboarding onComplete={finishOnboarding} />
  return <Workspace />
}
