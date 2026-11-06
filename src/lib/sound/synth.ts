export type SoundName =
  "opening" | "tap" | "open" | "close" | "success" | "error"

type Bell = {
  at: number
  pitch: number
  level: number
  decay: number
  brightness?: number
  pan?: number
}

const A3 = 220
const D3 = 146.83
const D4 = 293.66
const F4 = 349.23
const A4 = 440
const B4 = 493.88
const D5 = 587.33
const E5 = 659.25
const FS5 = 739.99
const A5 = 880

const ATTACK = 0.008
const SILENCE = 0.0001
const REVERB_SECONDS = 2
const REVERB_LEVEL = 0.28
const MASTER_LEVEL = 0.8

const BELLS: Record<Exclude<SoundName, "tap">, Bell[]> = {
  opening: [
    { at: 0, pitch: D4, level: 0.16, decay: 2.6, pan: -0.4 },
    { at: 0.18, pitch: A4, level: 0.14, decay: 2.4, pan: -0.25 },
    { at: 0.36, pitch: B4, level: 0.12, decay: 2.2, pan: -0.1 },
    { at: 0.54, pitch: D5, level: 0.13, decay: 2.4, pan: 0.1 },
    { at: 0.72, pitch: E5, level: 0.1, decay: 2.2, pan: 0.25 },
    { at: 0.9, pitch: A5, level: 0.1, decay: 2.8, pan: 0.4 },
  ],
  open: [
    { at: 0, pitch: A4, level: 0.11, decay: 0.5, brightness: 0.6 },
    { at: 0.06, pitch: D5, level: 0.11, decay: 0.6, brightness: 0.6 },
  ],
  close: [
    { at: 0, pitch: D5, level: 0.08, decay: 0.4, brightness: 0.5 },
    { at: 0.06, pitch: A4, level: 0.08, decay: 0.5, brightness: 0.5 },
  ],
  success: [
    { at: 0, pitch: D5, level: 0.12, decay: 1.2 },
    { at: 0.08, pitch: FS5, level: 0.11, decay: 1.2 },
    { at: 0.16, pitch: A5, level: 0.11, decay: 1.5 },
  ],
  error: [
    { at: 0, pitch: A4, level: 0.13, decay: 0.45, brightness: 0.25 },
    { at: 0.11, pitch: F4, level: 0.13, decay: 0.6, brightness: 0.25 },
  ],
}

function playBell(
  context: BaseAudioContext,
  output: AudioNode,
  start: number,
  { at, pitch, level, decay, brightness = 1, pan = 0 }: Bell
) {
  const time = start + at
  const end = time + decay
  const carrier = context.createOscillator()
  const modulator = context.createOscillator()
  const depth = context.createGain()
  const envelope = context.createGain()
  const panner = context.createStereoPanner()

  panner.pan.value = pan
  carrier.frequency.value = pitch
  modulator.frequency.value = pitch * 2
  depth.gain.setValueAtTime(pitch * 1.4 * brightness, time)
  depth.gain.exponentialRampToValueAtTime(SILENCE, time + decay * 0.35)
  envelope.gain.setValueAtTime(0, time)
  envelope.gain.linearRampToValueAtTime(level, time + ATTACK)
  envelope.gain.exponentialRampToValueAtTime(SILENCE, end)

  modulator.connect(depth).connect(carrier.frequency)
  carrier.connect(envelope).connect(panner).connect(output)
  for (const oscillator of [carrier, modulator]) {
    oscillator.start(time)
    oscillator.stop(end + 0.02)
  }
}

function playTap(context: BaseAudioContext, output: AudioNode, start: number) {
  const body = context.createOscillator()
  const envelope = context.createGain()

  body.type = "triangle"
  body.frequency.setValueAtTime(760, start)
  body.frequency.exponentialRampToValueAtTime(380, start + 0.04)
  envelope.gain.setValueAtTime(0, start)
  envelope.gain.linearRampToValueAtTime(0.075, start + 0.003)
  envelope.gain.exponentialRampToValueAtTime(SILENCE, start + 0.08)

  body.connect(envelope).connect(output)
  body.start(start)
  body.stop(start + 0.1)
}

function playPad(context: BaseAudioContext, output: AudioNode, start: number) {
  for (const pitch of [D3, A3]) {
    const tone = context.createOscillator()
    const envelope = context.createGain()

    tone.frequency.value = pitch
    envelope.gain.setValueAtTime(SILENCE, start)
    envelope.gain.exponentialRampToValueAtTime(0.05, start + 1.1)
    envelope.gain.exponentialRampToValueAtTime(SILENCE, start + 3.2)

    tone.connect(envelope).connect(output)
    tone.start(start)
    tone.stop(start + 3.3)
  }
}

export function playNotes(
  context: BaseAudioContext,
  output: AudioNode,
  name: SoundName,
  start: number
) {
  if (name === "tap") {
    playTap(context, output, start)
    return
  }
  if (name === "opening") playPad(context, output, start)
  for (const bell of BELLS[name]) playBell(context, output, start, bell)
}

function reverbImpulse(context: BaseAudioContext) {
  const length = Math.floor(context.sampleRate * REVERB_SECONDS)
  const impulse = context.createBuffer(2, length, context.sampleRate)
  const smoothing = 0.35

  for (let channel = 0; channel < 2; channel++) {
    const samples = impulse.getChannelData(channel)
    let previous = 0
    for (let index = 0; index < length; index++) {
      const fade = (1 - index / length) ** 3.5
      previous += smoothing * (Math.random() * 2 - 1 - previous)
      samples[index] = previous * fade
    }
  }
  return impulse
}

export function buildChain(context: BaseAudioContext) {
  const input = context.createGain()
  const reverb = context.createConvolver()
  const reverbLevel = context.createGain()
  const tone = context.createBiquadFilter()
  const master = context.createGain()

  reverb.buffer = reverbImpulse(context)
  reverbLevel.gain.value = REVERB_LEVEL
  tone.type = "lowpass"
  tone.frequency.value = 5200
  master.gain.value = MASTER_LEVEL

  input.connect(tone)
  input.connect(reverb).connect(reverbLevel).connect(tone)
  tone.connect(master).connect(context.destination)
  return input
}
