import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, test } from "vitest"

import { EngineStatus } from "@/features/engine/engine-status"

afterEach(() => {
  cleanup()
  clearMocks()
})

test("shows the engine version once it is ready", async () => {
  mockIPC(() => ({ version: "v2.0.0" }))

  render(<EngineStatus />)

  expect(screen.getByText("Starting query engine…")).toBeTruthy()
  expect(await screen.findByText("DuckDB v2.0.0 ready")).toBeTruthy()
})

test("shows why the engine failed and recovers on restart", async () => {
  let calls = 0
  mockIPC(() => {
    calls += 1
    if (calls === 1) {
      throw { kind: "engine", message: "DuckDB error: out of memory" }
    }
    return { version: "v2.0.0" }
  })

  render(<EngineStatus />)

  expect(
    await screen.findByText(
      "Query engine failed to start: DuckDB error: out of memory"
    )
  ).toBeTruthy()

  await userEvent.click(
    screen.getByRole("button", { name: "Restart query engine" })
  )

  expect(await screen.findByText("DuckDB v2.0.0 ready")).toBeTruthy()
})
