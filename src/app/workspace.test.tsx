import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import {
  act,
  cleanup,
  fireEvent,
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
const chooseFile = vi.hoisted(() => vi.fn())

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: chooseFile }))

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
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400)
})

afterEach(() => {
  cleanup()
  clearMocks()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  chooseFile.mockReset()
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
  openTable?: () => unknown
  rows?: (args: unknown) => unknown
}

function renderWorkspace({
  connected = () => [],
  models = (providerId) =>
    providerId === "codex" ? CODEX_MODELS : CLAUDE_MODELS,
  chosen = null,
  onChoose,
  openTable,
  rows,
}: Backend = {}) {
  mockIPC((command, args) => {
    const payload = args as Record<string, unknown>
    if (command === "connected_providers") return connected()
    if (command === "list_models") return models(payload.providerId as string)
    if (command === "chosen_model") return chosen
    if (command === "choose_model") onChoose?.(payload.choice)
    if (command === "open_table") return openTable?.()
    if (command === "read_rows") return rows?.(payload)
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

test("says plainly that connections aren't ready yet", async () => {
  renderWorkspace()

  await userEvent.click(screen.getByRole("button", { name: /PostgreSQL/ }))

  expect(screen.getByRole("status").textContent).toBe(
    "Connections and sample datasets are coming next."
  )
})

test("the screen responds while a file is dragged over it", () => {
  renderWorkspace()

  act(() => drops.send({ payload: { type: "enter", paths: [], position: {} } }))
  expect(screen.getByRole("heading", { name: "Drop to open" })).toBeTruthy()

  act(() => drops.send({ payload: { type: "leave" } }))
  expect(
    screen.getByRole("heading", { name: "Drop files anywhere" })
  ).toBeTruthy()
})

const SALES_TABLE = {
  source: {
    path: "/data/sales.csv",
    format: "csv",
    encoding: "utf-8",
    repair: "none",
  },
  name: "sales.csv",
  rowCount: 2,
  skippedRows: 0,
  columns: [
    { name: "region", dataType: "VARCHAR", kind: "text" },
    { name: "amount", dataType: "BIGINT", kind: "number" },
  ],
}

function dropFile(path: string) {
  act(() =>
    drops.send({ payload: { type: "drop", paths: [path], position: {} } })
  )
}

test("dropping a file opens it in a table", async () => {
  renderWorkspace({
    openTable: () => SALES_TABLE,
    rows: () => [
      ["EMEA", "1200"],
      ["APAC", null],
    ],
  })

  dropFile("/data/sales.csv")

  expect(await screen.findByText("EMEA")).toBeTruthy()
  expect(screen.getByText("1200")).toBeTruthy()
  expect(screen.getByText("null")).toBeTruthy()
  expect(screen.getByRole("heading", { name: "sales.csv" })).toBeTruthy()
  expect(screen.getByRole("banner").textContent).toContain("sales.csv")
  expect(screen.getByText("2 rows, 2 columns")).toBeTruthy()
  expect(screen.getByRole("columnheader", { name: /region/ })).toBeTruthy()
})

test("the opened file sends the source back when reading rows", async () => {
  const onRead = vi.fn()
  renderWorkspace({
    openTable: () => SALES_TABLE,
    rows: (args) => {
      onRead(args)
      return [["EMEA", "1"]]
    },
  })

  dropFile("/data/sales.csv")
  await screen.findByText("EMEA")

  expect(onRead).toHaveBeenCalledWith(
    expect.objectContaining({
      source: SALES_TABLE.source,
      offset: 0,
      limit: 200,
    })
  )
})

test("says why a file can't be opened and stays on Home", async () => {
  renderWorkspace({
    openTable: () => {
      throw {
        kind: "unsupported-file",
        message: "Davis can't open a.xlsx yet.",
      }
    },
  })

  dropFile("/data/a.xlsx")

  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe(
      "Davis can't open a.xlsx yet."
    )
  )
  expect(
    screen.getByRole("heading", { name: "Drop files anywhere" })
  ).toBeTruthy()
})

function manyRows(args: unknown) {
  const { offset, limit } = args as { offset: number; limit: number }
  return Array.from({ length: limit }, (_, index) => [
    `row ${offset + index}`,
    String(index),
  ])
}

async function renderLargeTable() {
  renderWorkspace({
    openTable: () => ({ ...SALES_TABLE, rowCount: 1_000_000 }),
    rows: manyRows,
  })
  dropFile("/data/sales.csv")
  await screen.findByText("row 0")
  return screen.getByRole("region", { name: "Rows of sales.csv" })
}

test("the mouse wheel scrolls the table", async () => {
  const table = await renderLargeTable()

  fireEvent.wheel(table, { deltaY: 2800 })

  expect(await screen.findByText("row 100")).toBeTruthy()
  await waitFor(() => expect(screen.queryByText("row 0")).toBeNull())
  expect(screen.getByText(/^101 to /)).toBeTruthy()
})

test("the wheel never scrolls above the first row", async () => {
  const table = await renderLargeTable()

  fireEvent.wheel(table, { deltaY: -500 })

  await waitFor(() => expect(screen.getByText(/^1 to /)).toBeTruthy())
  expect(screen.getByText("row 0")).toBeTruthy()
})

test("the keyboard reaches the end of a huge table", async () => {
  const table = await renderLargeTable()

  fireEvent.keyDown(table, { key: "End" })

  expect(await screen.findByText("row 999999")).toBeTruthy()
})

test("Browse files opens the chosen file", async () => {
  chooseFile.mockResolvedValue("/data/sales.csv")
  renderWorkspace({
    openTable: () => SALES_TABLE,
    rows: () => [["EMEA", "1"]],
  })

  await userEvent.click(screen.getByRole("button", { name: "Browse files" }))

  expect(await screen.findByText("EMEA")).toBeTruthy()
})

test("cancelling Browse files stays on Home", async () => {
  chooseFile.mockResolvedValue(null)
  renderWorkspace()

  await userEvent.click(screen.getByRole("button", { name: "Browse files" }))

  await waitFor(() => expect(chooseFile).toHaveBeenCalled())
  expect(
    screen.getByRole("heading", { name: "Drop files anywhere" })
  ).toBeTruthy()
})

test("explains rows that had to be left out", async () => {
  renderWorkspace({
    openTable: () => ({
      ...SALES_TABLE,
      source: { ...SALES_TABLE.source, repair: "skip-bad-rows" },
      skippedRows: 3,
    }),
    rows: () => [["EMEA", "1"]],
  })

  dropFile("/data/sales.csv")

  expect(
    await screen.findByText("3 rows couldn't be read and were left out.")
  ).toBeTruthy()
})

test("a read failure can be retried", async () => {
  const report = vi.spyOn(console, "error").mockImplementation(() => {})
  let isDown = true
  renderWorkspace({
    openTable: () => SALES_TABLE,
    rows: () => {
      if (isDown) throw { kind: "missing-file", message: "Couldn't find it." }
      return [["EMEA", "1"]]
    },
  })

  dropFile("/data/sales.csv")
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Couldn't find it."
  )

  isDown = false
  await userEvent.click(screen.getByRole("button", { name: "Try again" }))

  expect(await screen.findByText("EMEA")).toBeTruthy()
  report.mockRestore()
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
