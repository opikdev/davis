import { invoke } from "@tauri-apps/api/core"

type OnboardingStatus = {
  isComplete: boolean
}

export function getOnboardingStatus() {
  return invoke<OnboardingStatus>("onboarding_status")
}

export function completeOnboarding() {
  return invoke<void>("complete_onboarding")
}
