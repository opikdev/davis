import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import type { DragDropEvent } from "@tauri-apps/api/webview"

import { Workspace } from "@/app/workspace"

type DropEvent = { payload: DragDropEvent }

const drops = vi.hoisted(() => ({
  send: (() => {}) as (event: unknown) => void,
}))

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (listener: (event: DropEvent) => void) => {
      drops.send = (event) => listener(event as DropEvent)
      return () => {}
    },
  }),
}))

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  Element.prototype.scrollIntoView = () => {}
})

afterEach(() => {
  cleanup()
  clearMocks()
  vi.unstubAllGlobals()
})

const CLAUDE_MODELS = [
  {
    id: "claude-opus",
    name: "Claude Opus",
    efforts: ["low", "medium", "xhigh"],
    defaultEffort: "medium",
  },
  {
    id: "claude-haiku",
    name: "Claude Haiku",
    efforts: ["low"],
    defaultEffort: "low",
  },
]
const CODEX_MODELS = [
  { id: "gpt-plain", name: "GPT Plain", efforts: [], defaultEffort: null },
]

type Backend = {
  connected?: () => unknown
  models?: (providerId: string) => unknown
  chosen?: unknown
  onChoose?: (choice: unknown) => void
}

function renderWorkspace({
  connected = () => [],
  models = (providerId) =>
    providerId === "codex" ? CODEX_MODELS : CLAUDE_MODELS,
  chosen = null,
  onChoose,
}: Backend = {}) {
  mockIPC((command, args) => {
    const payload = args as Record<string, unknown>
    if (command === "connected_providers") return connected()
    if (command === "list_models") return models(payload.providerId as string)
    if (command === "chosen_model") return chosen
    if (command === "choose_model") onChoose?.(payload.choice)
    return undefined
  })
  render(<Workspace />)
}

async function openPicker() {
  const picker = await screen.findByRole("button", { name: "Choose a model" })
  await waitFor(() => expect(picker.textContent).toContain("Claude Opus"))
  await userEvent.click(picker)
  return picker
}

async function renderSettings(backend: Backend = {}) {
  renderWorkspace(backend)
  await userEvent.click(screen.getByRole("button", { name: "Settings" }))
}

test("the main screen invites a file drop", () => {
  renderWorkspace()

  expect(
    screen.getByRole("heading", { name: "Drop files anywhere" })
  ).toBeTruthy()
  expect(screen.getByRole("button", { name: "Browse files" })).toBeTruthy()
})

test("offers connections and sample datasets, with no model picker", () => {
  renderWorkspace()

  for (const name of [
    /PostgreSQL/,
    /MySQL/,
    /Cloud storage/,
    /Online retail/,
    /Bank marketing/,
    /Bike sharing/,
  ]) {
    expect(screen.getByRole("button", { name })).toBeTruthy()
  }
  expect(screen.queryByRole("button", { name: "Choose a model" })).toBeNull()
})

test("says plainly that opening data isn't ready yet", async () => {
  renderWorkspace()

  await userEvent.click(screen.getByRole("button", { name: /PostgreSQL/ }))

  expect(screen.getByRole("status").textContent).toBe(
    "Opening data is the next step we're building."
  )
})

test("the screen responds while a file is dragged over it", async () => {
  renderWorkspace()

  act(() => drops.send({ payload: { type: "enter", paths: [], position: {} } }))
  expect(screen.getByRole("heading", { name: "Drop to open" })).toBeTruthy()

  act(() => drops.send({ payload: { type: "leave" } }))
  expect(
    screen.getByRole("heading", { name: "Drop files anywhere" })
  ).toBeTruthy()
})

test("a dropped file is named, even with a Windows path", async () => {
  renderWorkspace()

  act(() =>
    drops.send({
      payload: {
        type: "drop",
        paths: ["C:\\data\\sales.csv"],
        position: {},
      },
    })
  )

  expect(screen.getByRole("status").textContent).toContain("sales.csv:")
  expect(
    screen.getByRole("heading", { name: "Drop files anywhere" })
  ).toBeTruthy()
})

test("the sidebar opens each section", async () => {
  renderWorkspace()

  await userEvent.click(screen.getByRole("button", { name: "Data" }))
  expect(screen.getByText("No data yet")).toBeTruthy()

  await userEvent.click(screen.getByRole("button", { name: "Pages" }))
  expect(screen.getByText("No pages yet")).toBeTruthy()

  await userEvent.click(screen.getByRole("button", { name: "Settings" }))
  expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy()

  await userEvent.click(screen.getByRole("button", { name: "Home" }))
  expect(
    screen.getByRole("heading", { name: "Drop files anywhere" })
  ).toBeTruthy()
})

test("starts on the first model and its default effort", async () => {
  await renderSettings({ connected: () => ["claude-code"] })

  const picker = await screen.findByRole("button", { name: "Choose a model" })

  await waitFor(() => expect(picker.textContent).toContain("Claude Opus"))
  expect(picker.textContent).toContain("Medium")
})

test("restores the saved model", async () => {
  await renderSettings({
    connected: () => ["claude-code", "codex"],
    chosen: {
      providerId: "claude-code",
      modelId: "claude-haiku",
      modelName: "Claude Haiku",
      effort: "low",
    },
  })

  const picker = await screen.findByRole("button", { name: "Choose a model" })

  await waitFor(() => expect(picker.textContent).toContain("Claude Haiku"))
})

test("replaces a saved model the provider no longer offers", async () => {
  await renderSettings({
    connected: () => ["claude-code"],
    chosen: {
      providerId: "claude-code",
      modelId: "retired",
      modelName: "Retired",
      effort: null,
    },
  })

  const picker = await screen.findByRole("button", { name: "Choose a model" })

  await waitFor(() => expect(picker.textContent).toContain("Claude Opus"))
})

test("a saved model from a disconnected AI is ignored", async () => {
  await renderSettings({
    connected: () => ["claude-code"],
    chosen: {
      providerId: "codex",
      modelId: "gpt-plain",
      modelName: "GPT Plain",
      effort: null,
    },
  })

  const picker = await screen.findByRole("button", { name: "Choose a model" })

  await waitFor(() => expect(picker.textContent).toContain("Claude Opus"))
})

test("picking a model and effort saves them and closes the picker", async () => {
  const onChoose = vi.fn()
  await renderSettings({ connected: () => ["claude-code"], onChoose })
  const picker = await openPicker()

  await userEvent.click(
    await screen.findByRole("radio", { name: "Extra high" })
  )

  await waitFor(() => expect(picker.textContent).toContain("Extra high"))
  expect(onChoose).toHaveBeenLastCalledWith({
    providerId: "claude-code",
    modelId: "claude-opus",
    modelName: "Claude Opus",
    effort: "xhigh",
  })
  await waitFor(() => expect(screen.queryByRole("radiogroup")).toBeNull())
})

test("a new model keeps the effort if it can, or uses its default", async () => {
  const onChoose = vi.fn()
  await renderSettings({
    connected: () => ["claude-code"],
    chosen: {
      providerId: "claude-code",
      modelId: "claude-opus",
      modelName: "Claude Opus",
      effort: "xhigh",
    },
    onChoose,
  })
  await openPicker()

  await userEvent.click(
    await screen.findByRole("option", { name: "Claude Haiku" })
  )

  expect(onChoose).toHaveBeenLastCalledWith(
    expect.objectContaining({ modelId: "claude-haiku", effort: "low" })
  )
  expect(screen.getByRole("radiogroup")).toBeTruthy()
})

test("a model without effort levels closes the picker when picked", async () => {
  const onChoose = vi.fn()
  await renderSettings({ connected: () => ["claude-code", "codex"], onChoose })
  await openPicker()

  await userEvent.click(await screen.findByRole("button", { name: "Codex" }))
  await userEvent.click(
    await screen.findByRole("option", { name: "GPT Plain" })
  )

  expect(onChoose).toHaveBeenLastCalledWith({
    providerId: "codex",
    modelId: "gpt-plain",
    modelName: "GPT Plain",
    effort: null,
  })
  await waitFor(() =>
    expect(screen.queryByRole("combobox", { name: "Search models" })).toBeNull()
  )
})

test("the composer keeps the current model while another AI is browsed", async () => {
  await renderSettings({ connected: () => ["claude-code", "codex"] })
  const picker = await openPicker()

  await userEvent.click(await screen.findByRole("button", { name: "Codex" }))
  await screen.findByRole("option", { name: "GPT Plain" })

  expect(picker.textContent).toContain("Claude Opus")
})

test("pointing at a model shows its efforts, and one click picks both", async () => {
  const onChoose = vi.fn()
  await renderSettings({ connected: () => ["claude-code"], onChoose })
  const picker = await openPicker()
  await screen.findByRole("radio", { name: "Extra high" })

  await userEvent.hover(screen.getByRole("option", { name: "Claude Haiku" }))
  await waitFor(() =>
    expect(screen.queryByRole("radio", { name: "Extra high" })).toBeNull()
  )
  await userEvent.click(screen.getByRole("radio", { name: /Low/ }))

  await waitFor(() => expect(picker.textContent).toContain("Claude Haiku"))
  expect(onChoose).toHaveBeenCalledTimes(1)
  expect(onChoose).toHaveBeenLastCalledWith({
    providerId: "claude-code",
    modelId: "claude-haiku",
    modelName: "Claude Haiku",
    effort: "low",
  })
})

test("each connected AI appears once in the rail", async () => {
  await renderSettings({
    connected: () => ["claude-code", "cloudflare", "codex"],
  })
  await openPicker()

  const rail = await screen.findByRole("group", { name: "AI" })

  expect(
    within(rail)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"))
  ).toEqual(["Claude Code", "Codex"])
})

test("one connected AI needs no rail", async () => {
  await renderSettings({ connected: () => ["claude-code"] })
  await openPicker()

  await screen.findByRole("radiogroup")

  expect(screen.queryByRole("group", { name: "AI" })).toBeNull()
})

test("searching narrows the models", async () => {
  await renderSettings({ connected: () => ["claude-code"] })
  await openPicker()

  await userEvent.type(
    await screen.findByRole("combobox", { name: "Search models" }),
    "haiku"
  )

  await waitFor(() =>
    expect(screen.queryByRole("option", { name: "Claude Opus" })).toBeNull()
  )
  expect(screen.getByRole("option", { name: "Claude Haiku" })).toBeTruthy()
})

test("offers a retry when models can't be listed", async () => {
  const report = vi.spyOn(console, "error").mockImplementation(() => {})
  let isDown = true
  await renderSettings({
    connected: () => ["claude-code"],
    models: () => {
      if (isDown) throw { kind: "unreachable", message: "offline" }
      return CLAUDE_MODELS
    },
  })
  await userEvent.click(
    await screen.findByRole("button", { name: "Choose a model" })
  )
  expect(
    await screen.findByText("Couldn't load the models from Claude Code.")
  ).toBeTruthy()

  isDown = false
  await userEvent.click(screen.getByRole("button", { name: "Try again" }))

  expect(
    await screen.findByRole("option", { name: "Claude Opus" })
  ).toBeTruthy()
  report.mockRestore()
})

test("says when no AI is connected", async () => {
  await renderSettings()

  expect(await screen.findByText("No AI connected")).toBeTruthy()
  expect(screen.queryByRole("button", { name: "Choose a model" })).toBeNull()
})

test("still works if the connected AIs can't be read", async () => {
  const report = vi.spyOn(console, "error").mockImplementation(() => {})
  await renderSettings({
    connected: () => {
      throw { kind: "settings", message: "unreadable" }
    },
  })

  expect(await screen.findByText("No AI connected")).toBeTruthy()
  report.mockRestore()
})

test("the sidebar collapses and comes back", async () => {
  renderWorkspace()
  const toggle = screen.getByRole("button", { name: "Toggle sidebar" })
  const sidebar = () =>
    screen.getByRole("navigation", { name: "Main", hidden: true })

  await userEvent.click(toggle)

  await waitFor(() => expect(sidebar().hasAttribute("inert")).toBe(true))
  expect(toggle.closest("header")).toBeTruthy()
  expect(sidebar().contains(toggle)).toBe(false)

  await userEvent.click(toggle)

  await waitFor(() => expect(sidebar().hasAttribute("inert")).toBe(false))
})

test("the sound toggle sits beside Settings in the sidebar", () => {
  renderWorkspace()
  const sidebar = screen.getByRole("navigation", { name: "Main" })

  const sound = within(sidebar).getByRole("button", { name: "Sound effects" })
  const settings = within(sidebar).getByRole("button", { name: "Settings" })

  expect(sound.closest('[data-slot="sidebar-footer"]')).toBe(
    settings.closest('[data-slot="sidebar-footer"]')
  )
  expect(settings.contains(sound)).toBe(false)
})

test("the window can be dragged from the top of the sidebar and panel", () => {
  renderWorkspace()

  const regions = document.querySelectorAll('[data-tauri-drag-region="deep"]')

  expect(regions).toHaveLength(2)
})
