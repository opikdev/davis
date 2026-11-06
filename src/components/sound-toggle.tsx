import { VolumeHighIcon, VolumeOffIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useState } from "react"

import { Toggle } from "@/components/ui/toggle"
import { isSoundOn, setSoundOn } from "@/lib/sound/player"

export function SoundToggle() {
  const [isOn, setIsOn] = useState(isSoundOn)

  return (
    <Toggle
      aria-label="Sound effects"
      pressed={isOn}
      onPressedChange={(next) => {
        setSoundOn(next)
        setIsOn(next)
      }}
      className="text-muted-foreground aria-pressed:bg-transparent"
    >
      <HugeiconsIcon
        key={String(isOn)}
        icon={isOn ? VolumeHighIcon : VolumeOffIcon}
        strokeWidth={1.5}
        className="animate-pop"
      />
    </Toggle>
  )
}
