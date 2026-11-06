import { useState, type CSSProperties } from "react"

import { AiSetup, useConnections, useDetectedTools } from "@/features/ai-setup"
import { WelcomeStep } from "@/features/onboarding/welcome-step"

export function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<"welcome" | "ai-setup">("welcome")
  const [stepFrom, setStepFrom] = useState("0px")
  const detection = useDetectedTools()
  const connections = useConnections(
    detection.tools,
    detection.isDetecting,
    detection.refresh
  )

  function goTo(next: typeof step, from: string) {
    setStepFrom(from)
    setStep(next)
  }

  return (
    <div
      className="contents"
      style={{ "--step-from": stepFrom } as CSSProperties}
    >
      {step === "welcome" ? (
        <WelcomeStep
          stepLabel="1 of 2"
          onContinue={() => goTo("ai-setup", "16px")}
        />
      ) : (
        <AiSetup
          stepLabel="2 of 2"
          detection={detection}
          connections={connections}
          onBack={() => goTo("welcome", "-16px")}
          onDone={onComplete}
        />
      )}
    </div>
  )
}
