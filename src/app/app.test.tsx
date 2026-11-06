import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, test } from "vitest"

import { App } from "@/app/app"

afterEach(() => {
  cleanup()
  clearMocks()
})

function mockBackend(onboardingStatus: () => unknown) {
  const commands: string[] = []
  mockIPC((command) => {
    commands.push(command)
    if (command === "onboarding_status") return onboardingStatus()
    if (command === "detect_ai_tools")
      return { apps: [], localServers: [], hasNpm: true }
    return undefined
  })
  return commands
}

test("shows onboarding on first launch", async () => {
  mockBackend(() => ({ isComplete: false }))

  render(<App />)

  expect(
    await screen.findByRole("heading", { name: "Get answers from your data" })
  ).toBeTruthy()
})

test("skips onboarding once it is complete", async () => {
  mockBackend(() => ({ isComplete: true }))

  render(<App />)

  expect(await screen.findByRole("main", { name: "Davis" })).toBeTruthy()
  expect(screen.queryByRole("button", { name: "Get started" })).toBeNull()
})

test("shows onboarding if its status cannot be read", async () => {
  mockBackend(() => {
    throw { kind: "settings", message: "damaged file" }
  })

  render(<App />)

  expect(
    await screen.findByRole("button", { name: "Get started" })
  ).toBeTruthy()
})

test("saves that onboarding is complete", async () => {
  const commands = mockBackend(() => ({ isComplete: false }))
  render(<App />)

  await userEvent.click(
    await screen.findByRole("button", { name: "Get started" })
  )
  await userEvent.click(screen.getByRole("button", { name: "Skip for now" }))

  await waitFor(() => expect(commands).toContain("complete_onboarding"))
})

test("the window can be dragged from the top of onboarding", async () => {
  mockBackend(() => ({ isComplete: false }))

  render(<App />)

  const titleBar = await screen.findByRole("banner")
  expect(titleBar.getAttribute("data-tauri-drag-region")).toBe("deep")
  expect(
    within(titleBar).getByRole("button", { name: "Sound effects" })
  ).toBeTruthy()
})

test("after onboarding the screen shows only the logo, and still drags", async () => {
  mockBackend(() => ({ isComplete: true }))

  render(<App />)

  const screenContent = await screen.findByRole("main", { name: "Davis" })
  expect(screenContent.textContent).toBe("")
  expect(screenContent.querySelector("svg")).toBeTruthy()
  expect(screen.queryByRole("button")).toBeNull()
  expect(
    screen.getByRole("banner").getAttribute("data-tauri-drag-region")
  ).toBe("deep")
})
