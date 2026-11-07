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

// The panel library measures real layout, which jsdom doesn't have.
vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResizablePanel: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResizableHandle: () => null,
}))

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
  ask?: (args: unknown) => unknown
  onStop?: (turn: unknown) => void
  project?: ProjectFixture
  saved?: SavedChatFixture[]
  onSaveChat?: (chat: unknown) => void
  commands?: string[]
}

type ProjectFixture = {
  path: string
  name: string
  files: { name: string; path: string; sizeBytes: number }[]
  chats: { id: string; title: string; updatedAt: number }[]
}

type SavedChatFixture = {
  id: string
  title: string
  updatedAt: number
  table: string | null
  turns: unknown[]
}

function fileOf(table: { name: string; source: { path: string } }) {
  return { name: table.name, path: table.source.path, sizeBytes: 4 }
}

function renderWorkspace({
  connected = () => [],
  models = (providerId) =>
    providerId === "codex" ? CODEX_MODELS : CLAUDE_MODELS,
  chosen = null,
  onChoose,
  openTable,
  rows,
  ask,
  onStop,
  project: existing,
  saved = [],
  onSaveChat,
  commands,
}: Backend = {}) {
  let current = existing
  const chats = [...saved]

  mockIPC((command, args) => {
    const payload = args as Record<string, unknown>
    commands?.push(command)
    if (command === "last_project") return existing ?? null
    if (command === "recent_projects")
      return current ? [{ path: current.path, name: current.name }] : []
    if (command === "create_project") {
      const name = payload.name as string
      current = { path: `/docs/${name}`, name, files: [], chats: [] }
      return current
    }
    if (command === "open_project") return { ...current }
    if (command === "rename_project") {
      const name = payload.name as string
      const path = `/docs/${name}`
      const files = (current?.files ?? []).map((file) => ({
        ...file,
        path: `${path}/data/${file.name}`,
      }))
      current = { path, name, files, chats: current?.chats ?? [] }
      return current
    }
    if (command === "add_project_file") {
      const table = openTable?.() as typeof SALES_TABLE
      if (current) current.files = [fileOf(table)]
      return table
    }
    if (command === "remove_project_file" && current) {
      current.files = current.files.filter(({ name }) => name !== payload.name)
      return undefined
    }
    if (command === "save_chat") {
      const chat = payload.chat as SavedChatFixture
      onSaveChat?.(chat)
      if (current) current.chats = [chat]
      return undefined
    }
    if (command === "read_chat")
      return chats.find(({ id }) => id === payload.id)
    if (command === "delete_chat" && current) {
      current.chats = current.chats.filter(({ id }) => id !== payload.id)
      return undefined
    }
    if (command === "connected_providers") return connected()
    if (command === "list_models") return models(payload.providerId as string)
    if (command === "chosen_model") return chosen
    if (command === "choose_model") onChoose?.(payload.choice)
    if (command === "open_table") return openTable?.()
    if (command === "read_rows") return rows?.(payload)
    if (command === "ask_about_table") return ask?.(payload)
    if (command === "stop_asking") onStop?.(payload.turn)
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

const SALES_ANSWER = {
  title: "Sales by region",
  sql: "SELECT region, sum(amount) AS total FROM data GROUP BY 1",
  chart: { kind: "bar", x: "region", y: "total" },
  result: {
    columns: [
      { name: "region", dataType: "VARCHAR", kind: "text" },
      { name: "total", dataType: "BIGINT", kind: "number" },
    ],
    rows: [
      ["EMEA", "1500"],
      ["APAC", "900"],
    ],
    isTruncated: false,
  },
}

async function renderOpenTable(
  ask: Backend["ask"],
  onStop?: Backend["onStop"],
  extra: Backend = {}
) {
  renderWorkspace({
    connected: () => ["claude-code"],
    openTable: () => SALES_TABLE,
    rows: () => [["EMEA", "1200"]],
    ask,
    onStop,
    ...extra,
  })
  dropFile("/data/sales.csv")
  await screen.findByText("1200")
}

async function askQuestion(text: string) {
  const box = screen.getByRole("textbox", { name: "Ask about this data" })
  await userEvent.type(box, `${text}{Enter}`)
}

test("asking shows the answer, its rows, and the query", async () => {
  await renderOpenTable(() => SALES_ANSWER)

  await askQuestion("Sales by region?")

  expect(
    await screen.findByRole("heading", { name: "Sales by region" })
  ).toBeTruthy()
  expect(screen.getByText("Sales by region?")).toBeTruthy()
  expect(screen.getByText("1500")).toBeTruthy()
})

test("the work is shown as it happens, then folds away", async () => {
  await renderOpenTable((args) => {
    const steps = (args as { onStep: { onmessage: (step: unknown) => void } })
      .onStep
    steps.onmessage({
      id: "read",
      kind: "read",
      status: "done",
      label: "Read columns",
      detail: "2 names and types",
      body: null,
    })
    steps.onmessage({
      id: "write-1",
      kind: "write",
      status: "running",
      label: "Writing query",
      detail: null,
      body: "SELECT region",
    })
    return new Promise((resolve) =>
      setTimeout(() => {
        steps.onmessage({
          id: "write-1",
          kind: "write",
          status: "done",
          label: "Writing query",
          detail: null,
          body: SALES_ANSWER.sql,
        })
        resolve(SALES_ANSWER)
      }, 80)
    )
  })

  await askQuestion("Sales?")

  expect(await screen.findByText("Read columns")).toBeTruthy()
  expect(screen.getByText("SELECT region")).toBeTruthy()
  expect(screen.getByRole("status").textContent).toContain("Writing query")

  await screen.findByRole("heading", { name: "Sales by region" })
  expect(screen.queryByText("Read columns")).toBeNull()

  await userEvent.click(screen.getByRole("button", { name: /Worked for/ }))
  expect(await screen.findByText(SALES_ANSWER.sql)).toBeTruthy()
})

test("Stop ends the question and tells the app", async () => {
  const onStop = vi.fn()
  await renderOpenTable(() => new Promise(() => {}), onStop)

  await askQuestion("Sales?")
  await userEvent.click(await screen.findByRole("button", { name: "Stop" }))

  expect(await screen.findByText("Stopped")).toBeTruthy()
  expect(onStop).toHaveBeenCalledWith(1)
  expect(screen.getByRole("button", { name: "Send" })).toBeTruthy()
})

test("A stopped question shows no error", async () => {
  await renderOpenTable(() => {
    throw { kind: "stopped", message: "Stopped." }
  })

  await askQuestion("Sales?")

  expect(await screen.findByText("Stopped")).toBeTruthy()
  expect(screen.queryByRole("alert")).toBeNull()
})

const SAVED_PROJECT = {
  path: "/docs/Q3",
  name: "Q3",
  files: [
    { name: "other.csv", path: "/docs/Q3/data/other.csv", sizeBytes: 4 },
    { name: "sales.csv", path: "/data/sales.csv", sizeBytes: 4 },
  ],
  chats: [{ id: "chat-1", title: "Sales by region", updatedAt: 5 }],
}

const SAVED_CHAT = {
  id: "chat-1",
  title: "Sales by region",
  updatedAt: 5,
  table: "sales.csv",
  turns: [
    {
      id: 7,
      question: "Sales by region?",
      startedAt: 1,
      finishedAt: 2,
      steps: [],
      answer: {
        title: "Saved answer",
        sql: null,
        chart: null,
        result: null,
      },
    },
  ],
}

function projectBackend(extra: Backend = {}): Backend {
  return {
    project: structuredClone(SAVED_PROJECT),
    saved: [SAVED_CHAT],
    openTable: () => SALES_TABLE,
    rows: () => [["EMEA", "1200"]],
    connected: () => ["claude-code"],
    ...extra,
  }
}

test("a first file creates a project named after it", async () => {
  renderWorkspace({
    openTable: () => SALES_TABLE,
    rows: () => [["EMEA", "1200"]],
  })

  dropFile("/Downloads/sales_2026.csv")
  await screen.findByText("EMEA")

  const nav = screen.getByRole("navigation", { name: "Main" })
  expect(within(nav).getByText("sales_2026")).toBeTruthy()
  expect(within(nav).getByRole("button", { name: "sales.csv" })).toBeTruthy()
})

test("a file Davis can't read leaves no project behind", async () => {
  const commands: string[] = []
  renderWorkspace({
    commands,
    openTable: () => {
      throw { kind: "unsupported-file", message: "Davis can't open a.xlsx." }
    },
  })

  dropFile("/data/a.xlsx")

  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe(
      "Davis can't open a.xlsx."
    )
  )
  expect(commands).not.toContain("create_project")
})

test("files join the open project instead of starting a new one", async () => {
  const commands: string[] = []
  renderWorkspace(projectBackend({ commands }))
  await screen.findByText("Saved answer")

  dropFile("/data/sales.csv")
  await waitFor(() => expect(commands).toContain("add_project_file"))

  expect(commands).not.toContain("create_project")
})

test("every dropped file is added", async () => {
  const commands: string[] = []
  renderWorkspace({
    commands,
    openTable: () => SALES_TABLE,
    rows: () => [["EMEA", "1200"]],
  })

  act(() =>
    drops.send({
      payload: {
        type: "drop",
        paths: ["/data/a.csv", "/data/b.csv"],
        position: {},
      },
    })
  )
  await screen.findByText("EMEA")

  expect(commands.filter((name) => name === "add_project_file")).toHaveLength(2)
  expect(commands.filter((name) => name === "create_project")).toHaveLength(1)
})

test("reopening Davis brings back the project, its file and its chat", async () => {
  renderWorkspace(projectBackend())

  expect(await screen.findByText("Saved answer")).toBeTruthy()
  expect(await screen.findByText("EMEA")).toBeTruthy()
  expect(screen.getByRole("heading", { name: "sales.csv" })).toBeTruthy()
  const nav = screen.getByRole("navigation", { name: "Main" })
  expect(within(nav).getByText("Q3")).toBeTruthy()
})

test("a finished answer is saved under its title", async () => {
  const onSaveChat = vi.fn()
  await renderOpenTable(() => SALES_ANSWER, undefined, { onSaveChat })

  await askQuestion("Sales?")
  await screen.findByRole("heading", { name: "Sales by region" })

  await waitFor(() => expect(onSaveChat).toHaveBeenCalled())
  expect(onSaveChat.mock.lastCall?.[0]).toMatchObject({
    title: "Sales by region",
    table: "sales.csv",
    turns: [{ question: "Sales?" }],
  })
  expect(
    await screen.findByRole("button", { name: "Delete Sales by region" })
  ).toBeTruthy()
})

test("opening a saved chat does not save it again", async () => {
  const onSaveChat = vi.fn()
  renderWorkspace(projectBackend({ onSaveChat }))

  await screen.findByText("Saved answer")

  expect(onSaveChat).not.toHaveBeenCalled()
})

test("a chat that can't be saved says so", async () => {
  await renderOpenTable(() => SALES_ANSWER, undefined, {
    onSaveChat: () => {
      throw { kind: "project-storage", message: "The disk is full." }
    },
  })

  await askQuestion("Sales?")

  expect((await screen.findByRole("alert")).textContent).toContain(
    "This chat couldn't be saved. The disk is full."
  )
})

test("renaming a project keeps the open file and chat working", async () => {
  const onRead = vi.fn()
  renderWorkspace(
    projectBackend({
      rows: (args) => {
        onRead(args)
        return [["EMEA", "1200"]]
      },
    })
  )
  await screen.findByText("Saved answer")

  await userEvent.click(
    await screen.findByRole("button", { name: "Choose a project" })
  )
  await userEvent.click(
    await screen.findByRole("menuitem", { name: "Rename project" })
  )
  const name = await screen.findByLabelText("Name")
  await userEvent.clear(name)
  await userEvent.type(name, "Q4{Enter}")

  const nav = screen.getByRole("navigation", { name: "Main" })
  expect(await within(nav).findByText("Q4")).toBeTruthy()
  expect(screen.getByText("Saved answer")).toBeTruthy()
})

test("removing a file asks first, then opens the next one", async () => {
  const commands: string[] = []
  renderWorkspace(projectBackend({ commands }))
  await screen.findByText("Saved answer")

  await userEvent.click(
    await screen.findByRole("button", { name: "Remove sales.csv" })
  )
  expect(screen.getByText("Remove sales.csv?")).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: "Keep it" }))
  expect(commands).not.toContain("remove_project_file")

  await userEvent.click(
    await screen.findByRole("button", { name: "Remove sales.csv" })
  )
  await userEvent.click(screen.getByRole("button", { name: "Remove file" }))

  await waitFor(() => expect(commands).toContain("remove_project_file"))
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "sales.csv" })).toBeNull()
  )
})

test("deleting the open chat starts a fresh one", async () => {
  renderWorkspace(projectBackend())
  await screen.findByText("Saved answer")

  await userEvent.click(
    await screen.findByRole("button", { name: "Delete Sales by region" })
  )
  await userEvent.click(screen.getByRole("button", { name: "Delete chat" }))

  await waitFor(() => expect(screen.queryByText("Saved answer")).toBeNull())
})

test("New chat starts over", async () => {
  await renderOpenTable(() => SALES_ANSWER)
  await askQuestion("Sales?")
  await screen.findByRole("heading", { name: "Sales by region" })

  await userEvent.click(
    within(screen.getByRole("complementary", { name: "Ask AI" })).getByRole(
      "button",
      { name: "New chat" }
    )
  )

  expect(screen.queryByRole("heading", { name: "Sales by region" })).toBeNull()
})

test("only the question, column names, and earlier queries are sent", async () => {
  const ask = vi.fn<(args: unknown) => unknown>(() => SALES_ANSWER)
  await renderOpenTable(ask)

  await askQuestion("First?")
  await screen.findByRole("heading", { name: "Sales by region" })
  await askQuestion("Second?")
  await waitFor(() => expect(ask).toHaveBeenCalledTimes(2))

  expect(ask.mock.calls[1][0]).toMatchObject({
    source: SALES_TABLE.source,
    request: {
      question: "Second?",
      columns: [
        { name: "region", dataType: "VARCHAR" },
        { name: "amount", dataType: "BIGINT" },
      ],
      history: [{ question: "First?", sql: SALES_ANSWER.sql }],
    },
  })
  expect(JSON.stringify(ask.mock.calls[1][0])).not.toContain("1200")
})

test("one number is shown as the answer itself", async () => {
  await renderOpenTable(() => ({
    title: "Row count",
    sql: "SELECT count(*) AS n FROM data",
    chart: null,
    result: {
      columns: [{ name: "n", dataType: "BIGINT", kind: "number" }],
      rows: [["2964624"]],
      isTruncated: false,
    },
  }))

  await askQuestion("How many?")

  expect(await screen.findByText("2964624")).toBeTruthy()
  expect(screen.queryByRole("table", { name: "Result" })).toBeNull()
})

test("an answer with no query still explains itself", async () => {
  await renderOpenTable(() => ({
    title: "This file has no date column",
    sql: null,
    chart: null,
    result: null,
  }))

  await askQuestion("Sales by month?")

  expect(
    await screen.findByRole("heading", { name: "This file has no date column" })
  ).toBeTruthy()
})

test("a failed question explains why and can be retried", async () => {
  const report = vi.spyOn(console, "error").mockImplementation(() => {})
  let isDown = true
  await renderOpenTable(() => {
    if (isDown)
      throw { kind: "ask-failed", message: "Claude Code couldn't answer." }
    return SALES_ANSWER
  })

  await askQuestion("Sales?")
  expect(await screen.findByText("Claude Code couldn't answer.")).toBeTruthy()

  isDown = false
  await userEvent.click(screen.getByRole("button", { name: "Try again" }))

  expect(
    await screen.findByRole("heading", { name: "Sales by region" })
  ).toBeTruthy()
  report.mockRestore()
})

test("Shift and Enter adds a line instead of sending", async () => {
  const ask = vi.fn(() => SALES_ANSWER)
  await renderOpenTable(ask)
  const box = screen.getByRole("textbox", { name: "Ask about this data" })

  await userEvent.type(box, "Line one{Shift>}{Enter}{/Shift}two")

  expect(ask).not.toHaveBeenCalled()
  expect(box).toHaveProperty("value", "Line one\ntwo")
})

test("the chat survives a visit to another section", async () => {
  await renderOpenTable(() => SALES_ANSWER)
  await askQuestion("Sales?")
  await screen.findByRole("heading", { name: "Sales by region" })

  await userEvent.click(screen.getByRole("button", { name: "Pages" }))
  await userEvent.click(
    await screen.findByRole("button", { name: "sales.csv" })
  )

  expect(
    await screen.findByRole("heading", { name: "Sales by region" })
  ).toBeTruthy()
})

test("Ask AI shows it's on, and turns the chat off and back", async () => {
  await renderOpenTable(() => SALES_ANSWER)
  const toggle = screen.getByRole("button", { name: "Ask AI" })
  expect(toggle.getAttribute("aria-pressed")).toBe("true")

  await userEvent.click(toggle)
  expect(toggle.getAttribute("aria-pressed")).toBe("false")

  await userEvent.click(toggle)
  expect(toggle.getAttribute("aria-pressed")).toBe("true")
})

test("the model shown first is saved, so chat can use it", async () => {
  const onChoose = vi.fn()
  await renderSettings({ connected: () => ["claude-code"], onChoose })

  await waitFor(() =>
    expect(onChoose).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "claude-opus", effort: "medium" })
    )
  )
})

test("a saved model is not replaced while it loads", async () => {
  const onChoose = vi.fn()
  await renderSettings({
    connected: () => ["claude-code"],
    chosen: {
      providerId: "claude-code",
      modelId: "claude-haiku",
      modelName: "Claude Haiku",
      effort: "low",
    },
    onChoose,
  })

  const picker = await screen.findByRole("button", { name: "Choose a model" })
  await waitFor(() => expect(picker.textContent).toContain("Claude Haiku"))

  expect(onChoose).not.toHaveBeenCalled()
})

test("Browse files opens the chosen file", async () => {
  chooseFile.mockResolvedValue(["/data/sales.csv"])
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
  await waitFor(() => expect(onChoose).toHaveBeenCalled())
  onChoose.mockClear()

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
