import { afterEach, beforeEach, expect, test, vi } from "vitest"

const playNotes = vi.fn()

vi.mock("@/lib/sound/synth", () => ({
  buildChain: () => ({}),
  playNotes,
}))

class FakeAudioContext {
  currentTime = 0
  resume = () => Promise.resolve()
}

async function loadPlayer() {
  vi.resetModules()
  const player = await import("@/lib/sound/player")
  return player
}

function played() {
  return playNotes.mock.calls.map((call) => call[2])
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  vi.stubGlobal("AudioContext", FakeAudioContext)
  localStorage.clear()
  playNotes.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

test("stays silent when the user turned sound off", async () => {
  const { playSound, setSoundOn, isSoundOn } = await loadPlayer()
  setSoundOn(false)

  playSound("success")
  await settle()

  expect(isSoundOn()).toBe(false)
  expect(played()).toEqual([])
})

test("sound is on until the user turns it off", async () => {
  const { isSoundOn } = await loadPlayer()

  expect(isSoundOn()).toBe(true)
})

test("does nothing where audio isn't available", async () => {
  vi.stubGlobal("AudioContext", undefined)
  Reflect.deleteProperty(window, "AudioContext")
  const { playSound } = await loadPlayer()

  expect(() => playSound("tap")).not.toThrow()
})

test("a sound that can't start never reaches the caller", async () => {
  vi.stubGlobal(
    "AudioContext",
    class {
      constructor() {
        throw new Error("no audio device")
      }
    }
  )
  const report = vi.spyOn(console, "error").mockImplementation(() => {})
  const { playSound } = await loadPlayer()

  expect(() => playSound("tap")).not.toThrow()
  expect(report).toHaveBeenCalled()
  report.mockRestore()
})

test("a sound that fails to resume doesn't leave an unhandled rejection", async () => {
  vi.stubGlobal(
    "AudioContext",
    class extends FakeAudioContext {
      resume = () => Promise.reject(new Error("blocked"))
    }
  )
  const report = vi.spyOn(console, "error").mockImplementation(() => {})
  const { playSound } = await loadPlayer()

  playSound("tap")
  await settle()

  expect(report).toHaveBeenCalled()
  report.mockRestore()
})

test("plays the opening sound once, however often it's asked for", async () => {
  const { playOpeningSound } = await loadPlayer()

  playOpeningSound()
  playOpeningSound()
  await settle()

  expect(played()).toEqual(["opening"])
})

test("taps for pressable things, but not for anything else", async () => {
  const { playPressSounds } = await loadPlayer()
  const controller = new AbortController()
  const addEventListener = document.addEventListener.bind(document)
  vi.spyOn(document, "addEventListener").mockImplementation(
    (type: string, listener: EventListenerOrEventListenerObject) =>
      addEventListener(type, listener, { signal: controller.signal })
  )
  playPressSounds()
  document.body.innerHTML = `
    <button id="press"><span id="inside">Go</span></button>
    <button id="busy" aria-disabled="true">Wait</button>
    <p id="text">Text</p>`

  document.getElementById("text")?.click()
  document.getElementById("busy")?.click()
  await settle()
  expect(played()).toEqual([])

  document.getElementById("inside")?.click()
  await settle()
  expect(played()).toEqual(["tap"])
  controller.abort()
})
