import { buildChain, playNotes, type SoundName } from "@/lib/sound/synth"

const STORAGE_KEY = "davis.sound"
const PRESSABLE = 'button, a, [role="button"]'

type Output = { context: AudioContext; input: AudioNode }

let output: Output | undefined
let hasPlayedOpening = false

function audioOutput() {
  if (!("AudioContext" in window)) return undefined
  if (!output) {
    const context = new AudioContext({ latencyHint: "interactive" })
    output = { context, input: buildChain(context) }
  }
  return output
}

export function isSoundOn() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off"
  } catch {
    return true
  }
}

export function setSoundOn(isOn: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, isOn ? "on" : "off")
  } catch (error) {
    console.error("Could not save the sound setting", error)
  }
}

function reportSoundFailure(error: unknown) {
  console.error("Could not play a sound", error)
}

export function playSound(name: SoundName) {
  try {
    const audio = isSoundOn() ? audioOutput() : undefined
    if (!audio) return

    const { context, input } = audio
    context
      .resume()
      .then(() => {
        playNotes(context, input, name, context.currentTime + 0.01)
      })
      .catch(reportSoundFailure)
  } catch (error) {
    reportSoundFailure(error)
  }
}

export function playOpeningSound() {
  if (hasPlayedOpening) return
  hasPlayedOpening = true
  playSound("opening")
}

export function playPressSounds() {
  document.addEventListener("click", (event) => {
    const pressed = (event.target as Element).closest(PRESSABLE)
    if (pressed && pressed.getAttribute("aria-disabled") !== "true") {
      playSound("tap")
    }
  })
}
