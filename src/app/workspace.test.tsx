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
const writeText = vi.hoisted(() => vi.fn())

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
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText }))

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
  onReply?: (reply: unknown) => void
  profile?: () => unknown
  values?: (args: unknown) => unknown
  links?: () => unknown
  onCombine?: (args: unknown) => unknown
  pages?: PageFixture[]
  onRunPage?: (page: unknown) => void
  onBuild?: (spec: unknown) => void
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
  pages: { id: string; title: string; updatedAt: number }[]
}

type SavedChatFixture = {
  id: string
  title: string
  updatedAt: number
  table: string | null
  turns: unknown[]
}

type BlockFixture = {
  id: string
  kind: string
  title: string
  sql: string | null
  view: string | null
  xColumn: string | null
  yColumn: string | null
  text: string | null
}

type FilterFixture = {
  id: string
  table: string
  column: string
  kind: string
  values: string[]
  from: string | null
  to: string | null
}

type PageFixture = {
  id: string
  title: string
  updatedAt: number
  rows: { id: string; blocks: BlockFixture[] }[]
  filters: FilterFixture[]
}

const BLANK_BLOCK = {
  kind: "text",
  title: "",
  weight: 1,
  sql: null,
  trendSql: null,
  spec: null,
  view: null,
  xColumn: null,
  yColumn: null,
  seriesColumn: null,
  format: null,
  showLabels: true,
  sort: null,
  limit: null,
  text: null,
  sources: {},
}

function inRows(...blocks: BlockFixture[]) {
  return blocks.map((block) => ({ id: `row-${block.id}`, blocks: [block] }))
}

function blocksOf(page: PageFixture) {
  return page.rows.flatMap((row) => row.blocks)
}

function pageResult(block: BlockFixture) {
  if (block.sql === "BROKEN") {
    return {
      id: block.id,
      result: null,
      error: "That query failed.",
      trend: null,
      sources: {},
    }
  }
  if (block.sql === "EMPTY") {
    return {
      id: block.id,
      error: null,
      trend: null,
      sources: {},
      result: { columns: [], rows: [], isTruncated: false },
    }
  }
  return {
    id: block.id,
    error: null,
    trend: null,
    sources: {},
    result: {
      columns: [
        { name: "region", dataType: "VARCHAR", kind: "text" },
        { name: "total", dataType: "BIGINT", kind: "number" },
      ],
      rows: [["EMEA", "1500"]],
      isTruncated: false,
    },
  }
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
  onReply,
  profile,
  values,
  links,
  onCombine,
  pages = [],
  onRunPage,
  onBuild,
  project: existing,
  saved = [],
  onSaveChat,
  commands,
}: Backend = {}) {
  let current = existing
  const savedPages = new Map(pages.map((page) => [page.id, page]))
  const chats = [...saved]

  mockIPC((command, args) => {
    const payload = args as Record<string, unknown>
    commands?.push(command)
    if (command === "save_page") {
      const page = payload.page as PageFixture
      savedPages.set(page.id, page)
      if (current) current.pages = [...savedPages.values()]
      return undefined
    }
    if (command === "read_page") return savedPages.get(payload.id as string)
    if (command === "delete_page") {
      savedPages.delete(payload.id as string)
      if (current) current.pages = [...savedPages.values()]
      return undefined
    }
    if (command === "add_block") {
      const page = savedPages.get(payload.id as string) as PageFixture
      const block = {
        ...BLANK_BLOCK,
        id: `b${blocksOf(page).length}`,
        ...(payload.block as object),
      }
      const next = { ...page, rows: [...page.rows, ...inRows(block)] }
      savedPages.set(page.id, next)
      return next
    }
    if (command === "draft_page") {
      const page = savedPages.get(payload.id as string) as PageFixture
      const next = { ...page, rows: inRows(DRAFTED_BLOCK) }
      savedPages.set(page.id, next)
      return next
    }
    if (command === "run_page") {
      onRunPage?.(payload.page)
      const page = payload.page as PageFixture
      return {
        blocks: blocksOf(page).flatMap((block) =>
          block.sql ? [pageResult(block)] : []
        ),
        filters: page.filters.flatMap((filter) =>
          filter.values.length > 0 || filter.from
            ? [{ id: filter.id, files: ["sales.csv", "orders.csv"] }]
            : []
        ),
      }
    }
    if (command === "project_columns") {
      return [
        {
          table: "sales.csv",
          columns: [
            { name: "region", dataType: "VARCHAR", kind: "text" },
            { name: "total", dataType: "BIGINT", kind: "number" },
          ],
        },
      ]
    }
    if (command === "build_block_query") {
      onBuild?.(payload.spec)
      return {
        sql: "SELECT built",
        trendSql: null,
        xColumn: "region",
        yColumn: "total",
        seriesColumn: null,
      }
    }
    if (command === "filter_bounds") return ["2026-01-01", "2026-04-30"]
    if (command === "filter_options") return ["EMEA", "APAC"]
    if (command === "data_files_in") return payload.paths
    if (command === "check_data_file") return openTable?.()
    if (command === "profile_table") return profile?.()
    if (command === "column_values") return values?.(payload)
    if (command === "project_links") return links?.() ?? []
    if (command === "combine_project_files") return onCombine?.(payload)
    if (command === "last_project") return existing ?? null
    if (command === "recent_projects")
      return current ? [{ path: current.path, name: current.name }] : []
    if (command === "create_project") {
      const name = payload.name as string
      current = { path: `/docs/${name}`, name, files: [], chats: [], pages: [] }
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
      current = {
        path,
        name,
        files,
        chats: current?.chats ?? [],
        pages: current?.pages ?? [],
      }
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
    if (command === "ask_project") return ask?.(payload)
    if (command === "answer_agent") return onReply?.(payload.reply) ?? true
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
  expect(
    screen.getByRole("heading", { name: "sales.csv", level: 1 })
  ).toBeTruthy()
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

const SALES_SQL = "SELECT region, sum(amount) AS total FROM sales GROUP BY 1"

const SALES_RESULT = {
  columns: [
    { name: "region", dataType: "VARCHAR", kind: "text" },
    { name: "total", dataType: "BIGINT", kind: "number" },
  ],
  rows: [
    ["EMEA", "1500"],
    ["APAC", "900"],
  ],
  isTruncated: false,
}

const SALES_ANSWER = {
  title: "Sales by region",
  text: "EMEA leads with {{q1.0.total}}.",
  figures: [
    { query: "q1", title: "Totals", view: "bar", x: "region", y: "total" },
  ],
  queries: { q1: { sql: SALES_SQL, result: SALES_RESULT } },
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

function emit(args: unknown, step: Record<string, unknown>) {
  const { onStep } = args as { onStep: { onmessage: (s: unknown) => void } }
  onStep.onmessage({ detail: null, body: null, ...step })
}

test("only the latest step shows while working, and all of them on request", async () => {
  await renderOpenTable((args) => {
    emit(args, {
      id: "read",
      kind: "read",
      status: "done",
      label: "Read 2 tables",
    })
    emit(args, {
      id: "run-q1",
      kind: "run",
      status: "running",
      label: "Compare regions",
      body: "SELECT region",
    })
    return new Promise(() => {})
  })

  await askQuestion("Sales?")

  expect(await screen.findByText("Compare regions")).toBeTruthy()
  expect(screen.queryByText("Read 2 tables")).toBeNull()
  expect(screen.getByText(/^Working for /)).toBeTruthy()

  await userEvent.click(screen.getByText(/^Working for /))

  expect(await screen.findByText("Read 2 tables")).toBeTruthy()
})

test("the answer streams in while the AI writes it", async () => {
  await renderOpenTable((args) => {
    emit(args, {
      id: "note-1",
      kind: "note",
      status: "running",
      label: "Note",
      body: "Sales rose by {{q1.0.total}}",
    })
    return new Promise(() => {})
  })

  await askQuestion("Sales?")

  expect(await screen.findByText("Sales rose by …")).toBeTruthy()
})

test("finished work folds into a plain summary", async () => {
  await renderOpenTable((args) => {
    emit(args, {
      id: "think-1",
      kind: "think",
      status: "done",
      label: "Thinking",
    })
    emit(args, {
      id: "run-q1",
      kind: "run",
      status: "done",
      label: "Compare regions",
      body: SALES_SQL,
    })
    emit(args, {
      id: "run-q2",
      kind: "run",
      status: "done",
      label: "Check totals",
      body: SALES_SQL,
    })
    emit(args, { id: "show-1", kind: "chart", status: "done", label: "Totals" })
    return SALES_ANSWER
  })

  await askQuestion("Sales?")
  await screen.findByRole("heading", { name: "Sales by region" })

  const summary = await screen.findByRole("button", {
    name: /^Worked for \d+s · 2 queries, 1 view$/,
  })
  expect(screen.queryByText("Compare regions")).toBeNull()

  await userEvent.click(summary)

  expect(await screen.findByText("Compare regions")).toBeTruthy()
  expect(screen.queryByText("Thinking")).toBeNull()
})

test("work stays open when the turn fails", async () => {
  const report = vi.spyOn(console, "error").mockImplementation(() => {})
  await renderOpenTable((args) => {
    emit(args, {
      id: "run-q1",
      kind: "run",
      status: "failed",
      label: "Compare regions",
      body: SALES_SQL,
    })
    throw { kind: "ask-failed", message: "Claude Code couldn't answer." }
  })

  await askQuestion("Sales?")

  expect(await screen.findByRole("alert")).toBeTruthy()
  expect(await screen.findByText("Compare regions")).toBeTruthy()
  report.mockRestore()
})

test("follow-up suggestions ask with one click, on the last answer only", async () => {
  const ask = vi.fn<(args: unknown) => unknown>(() => ({
    ...SALES_ANSWER,
    followUps: ["Why is EMEA ahead?"],
  }))
  await renderOpenTable(ask)

  await askQuestion("Sales?")
  await userEvent.click(
    await screen.findByRole("button", { name: "Why is EMEA ahead?" })
  )

  await waitFor(() => expect(ask).toHaveBeenCalledTimes(2))
  expect(ask.mock.calls[1][0]).toMatchObject({
    request: { question: "Why is EMEA ahead?" },
  })
})

test("an answer copies with its real numbers, not references", async () => {
  await renderOpenTable(() => SALES_ANSWER)

  await askQuestion("Sales?")
  fireEvent.click(await screen.findByRole("button", { name: "Copy answer" }))

  await waitFor(() =>
    expect(writeText).toHaveBeenCalledWith(
      `Sales by region\n\nEMEA leads with ${(1500).toLocaleString()}.`
    )
  )
  expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy()
})

test("Ask again replaces the answer with a fresh one", async () => {
  const ask = vi.fn<(args: unknown) => unknown>(() => SALES_ANSWER)
  await renderOpenTable(ask)

  await askQuestion("Sales?")
  await userEvent.click(
    await screen.findByRole("button", { name: "Ask again" })
  )

  await waitFor(() => expect(ask).toHaveBeenCalledTimes(2))
  expect(screen.getAllByRole("button", { name: "Ask again" })).toHaveLength(1)
})

test("number keys answer a question from the AI", async () => {
  const onReply = vi.fn()
  await renderOpenTable(askAndWait, undefined, { onReply })

  await askQuestion("Sales?")
  await screen.findByText("Which year?")
  await userEvent.type(
    screen.getByRole("textbox", { name: "Ask about this data" }),
    "2"
  )

  expect(onReply).toHaveBeenCalledWith("2026")
  expect(screen.getByRole("textbox")).toHaveProperty("value", "")
})

test("scrolling up stops following, and Jump to latest brings it back", async () => {
  await renderOpenTable(() => SALES_ANSWER)
  await askQuestion("Sales?")
  await screen.findByRole("heading", { name: "Sales by region" })
  const scroller = screen
    .getByRole("heading", { name: "Sales by region" })
    .closest(".overflow-y-auto") as HTMLElement
  Object.defineProperty(scroller, "scrollHeight", { value: 2000 })
  scroller.scrollTop = 900

  fireEvent.wheel(scroller, { deltaY: -100 })

  const jump = await screen.findByRole("button", { name: "Jump to latest" })
  await userEvent.click(jump)

  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Jump to latest" })).toBeNull()
  )
})

test("Stop ends the question and tells the app", async () => {
  const onStop = vi.fn()
  await renderOpenTable(() => new Promise(() => {}), onStop)

  await askQuestion("Sales?")
  await userEvent.click(await screen.findByRole("button", { name: "Stop" }))

  expect(await screen.findByText("You stopped this")).toBeTruthy()
  expect(onStop).toHaveBeenCalledWith(1)
  expect(screen.getByRole("button", { name: "Send" })).toBeTruthy()
})

test("A stopped question shows no error", async () => {
  await renderOpenTable(() => {
    throw { kind: "stopped", message: "Stopped." }
  })

  await askQuestion("Sales?")

  expect(await screen.findByText("You stopped this")).toBeTruthy()
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
  pages: [],
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

const SALES_PROFILE = [
  {
    name: "region",
    kind: "text",
    missingPercent: 12.5,
    uniqueValues: 3,
    min: "APAC",
    max: "EMEA",
    mean: null,
  },
  {
    name: "amount",
    kind: "number",
    missingPercent: 0,
    uniqueValues: 40,
    min: "5",
    max: "1200",
    mean: "310.5",
  },
  {
    name: "day",
    kind: "date",
    missingPercent: 0,
    uniqueValues: 90,
    min: "2026-01-01 00:00:00",
    max: "2026-03-31 00:00:00",
    mean: null,
  },
]

test("a new chat opens with a brief of the file, worked out locally", async () => {
  const ask = vi.fn()
  await renderOpenTable(ask, undefined, { profile: () => SALES_PROFILE })

  expect(await screen.findByText("2 rows and 2 columns.")).toBeTruthy()
  expect(
    await screen.findByText("day runs from 2026-01-01 to 2026-03-31.")
  ).toBeTruthy()
  expect(
    screen.getByText("region is missing 12.5% of its values.")
  ).toBeTruthy()
  expect(ask).not.toHaveBeenCalled()
})

test("the chat is honest about what the AI can see", async () => {
  await renderOpenTable(() => SALES_ANSWER)

  expect(
    screen.getByText(
      "The AI sees column names and up to 50 rows of each query it runs."
    )
  ).toBeTruthy()
  expect(screen.queryByText(/never your rows/)).toBeNull()
})

test("the table footer says when columns have gaps", async () => {
  await renderOpenTable(() => SALES_ANSWER, undefined, {
    profile: () => SALES_PROFILE,
  })

  expect(await screen.findByText("1 column with gaps")).toBeTruthy()
})

test("a file still opens if profiling fails", async () => {
  const report = vi.spyOn(console, "error").mockImplementation(() => {})
  await renderOpenTable(() => SALES_ANSWER, undefined, {
    profile: () => {
      throw { kind: "engine", message: "No." }
    },
  })

  expect(await screen.findByText("2 rows and 2 columns.")).toBeTruthy()
  expect(screen.getByText("1200")).toBeTruthy()
  report.mockRestore()
})

test("a folder with no data says so", async () => {
  renderWorkspace()
  mockIPC((command) => {
    if (command === "data_files_in") return []
    if (command === "recent_projects") return []
    return undefined
  })

  dropFile("/Users/me/Pictures")

  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe(
      "That folder has no data files in it."
    )
  )
})

const ORDERS_LINK = {
  fromFile: "sales.csv",
  fromColumn: "customer_id",
  toFile: "customers.csv",
  toColumn: "id",
  matchPercent: 100,
}

test("a linked file can be added with one click", async () => {
  const onCombine = vi.fn<(args: unknown) => unknown>(() => ({
    ...SALES_TABLE,
    name: "sales with customers.parquet",
  }))
  await renderOpenTable(() => SALES_ANSWER, undefined, {
    links: () => [ORDERS_LINK],
    onCombine,
  })

  await userEvent.click(
    await screen.findByRole("button", { name: "customers.csv" })
  )
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Add columns from customers.csv",
    })
  )

  await waitFor(() => expect(onCombine).toHaveBeenCalled())
  expect(onCombine.mock.lastCall?.[0]).toMatchObject({ link: ORDERS_LINK })
  expect(
    await screen.findByRole("heading", {
      name: "sales with customers.parquet",
      level: 1,
    })
  ).toBeTruthy()
})

test("a near match never reads as a perfect one", async () => {
  await renderOpenTable(() => SALES_ANSWER, undefined, {
    links: () => [{ ...ORDERS_LINK, matchPercent: 99.96 }],
  })

  await userEvent.click(
    await screen.findByRole("button", { name: "customers.csv" })
  )

  expect(await screen.findByText(/for 99\.9% of rows/)).toBeTruthy()
})

test("links from other files aren't offered on this one", async () => {
  await renderOpenTable(() => SALES_ANSWER, undefined, {
    links: () => [{ ...ORDERS_LINK, fromFile: "other.csv" }],
  })

  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "customers.csv" })).toBeNull()
  )
})

const DRAFTED_BLOCK = {
  ...BLANK_BLOCK,
  id: "drafted",
  kind: "figure",
  title: "Total amount",
  sql: "SELECT 1",
  view: "table",
}

const OVERVIEW: PageFixture = {
  id: "page-1",
  title: "Overview",
  updatedAt: 1,
  rows: inRows(
    {
      ...BLANK_BLOCK,
      id: "b1",
      kind: "figure",
      title: "Totals",
      sql: "SELECT 1",
      view: "table",
    },
    {
      ...BLANK_BLOCK,
      id: "b2",
      kind: "figure",
      title: "Broken one",
      sql: "BROKEN",
      view: "table",
    }
  ),
  filters: [
    {
      id: "f1",
      table: "sales.csv",
      column: "region",
      kind: "values",
      values: [],
      from: null,
      to: null,
    },
  ],
}

function pageBackend(extra: Backend = {}) {
  return projectBackend({
    project: {
      ...structuredClone(SAVED_PROJECT),
      pages: [{ id: "page-1", title: "Overview", updatedAt: 1 }],
    },
    pages: [structuredClone(OVERVIEW)],
    ...extra,
  })
}

async function startNewChat() {
  const nav = screen.getByRole("navigation", { name: "Main" })
  await userEvent.click(within(nav).getByRole("button", { name: "New chat" }))
}

async function openOverview() {
  await userEvent.click(await screen.findByRole("button", { name: "Overview" }))
  await screen.findByRole("heading", { name: "Overview", level: 1 })
}

async function startEditing() {
  await userEvent.click(await screen.findByRole("button", { name: "Edit" }))
}

test("New Page offers starting points that work without the AI", async () => {
  renderWorkspace(projectBackend())
  await screen.findByText("Saved answer")

  await userEvent.click(screen.getByRole("button", { name: "New Page" }))
  await userEvent.click(
    await screen.findByRole("button", { name: /^Overview/ })
  )

  expect(
    await screen.findByRole("heading", { name: "Total amount" })
  ).toBeTruthy()
})

test("a blank Page opens ready to edit", async () => {
  renderWorkspace(projectBackend())
  await screen.findByText("Saved answer")

  await userEvent.click(screen.getByRole("button", { name: "New Page" }))
  await userEvent.click(
    await screen.findByRole("button", { name: "Start with a blank Page" })
  )

  expect(await screen.findByLabelText("Page title")).toHaveProperty(
    "value",
    "Untitled page"
  )
})

test("a Page runs its blocks, and one failure stays in its block", async () => {
  renderWorkspace(pageBackend())

  await openOverview()

  expect(await screen.findByText("That query failed.")).toBeTruthy()
  expect(await screen.findByRole("cell", { name: "1500" })).toBeTruthy()
  expect(screen.getByRole("heading", { name: "Totals" })).toBeTruthy()
})

test("a filtered chart keeps showing with a single bar", async () => {
  const chart = {
    ...BLANK_BLOCK,
    id: "b1",
    kind: "figure",
    title: "By region",
    sql: "SELECT 1",
    view: "bar",
    xColumn: "region",
    yColumn: "total",
  }
  renderWorkspace(
    pageBackend({ pages: [{ ...OVERVIEW, rows: inRows(chart) }] })
  )

  await openOverview()

  expect(await screen.findByRole("img", { name: "By region" })).toBeTruthy()
})

test("a block says so when a filter leaves it nothing to show", async () => {
  const empty = {
    ...BLANK_BLOCK,
    id: "b1",
    kind: "figure",
    title: "By region",
    sql: "EMPTY",
    view: "bar",
  }
  renderWorkspace(
    pageBackend({ pages: [{ ...OVERVIEW, rows: inRows(empty) }] })
  )

  await openOverview()

  expect(await screen.findByText("Nothing matches this filter.")).toBeTruthy()
})

test("renaming a Page saves on leaving the title", async () => {
  renderWorkspace(pageBackend())
  await openOverview()
  await startEditing()

  const title = await screen.findByLabelText("Page title")
  await userEvent.clear(title)
  await userEvent.type(title, "Q3 review{Enter}")

  expect(await screen.findByRole("button", { name: "Q3 review" })).toBeTruthy()
})

test("choosing a filter value runs the Page again with it", async () => {
  const onRunPage = vi.fn()
  renderWorkspace(pageBackend({ onRunPage }))
  await openOverview()
  await screen.findByText("That query failed.")

  await userEvent.click(screen.getByRole("button", { name: "Filter region" }))
  await userEvent.click(
    await screen.findByRole("menuitemcheckbox", { name: "EMEA" })
  )

  await waitFor(() => expect(onRunPage).toHaveBeenCalledTimes(2))
  expect(onRunPage.mock.lastCall?.[0]).toMatchObject({
    filters: [expect.objectContaining({ id: "f1", values: ["EMEA"] })],
  })
  expect(
    await screen.findByText("Filtering sales.csv, orders.csv")
  ).toBeTruthy()
})

test("an answer can be pinned to a Page", async () => {
  renderWorkspace(
    pageBackend({
      ask: () => SALES_ANSWER,
      saved: [],
      project: {
        ...structuredClone(SAVED_PROJECT),
        chats: [],
        pages: [{ id: "page-1", title: "Overview", updatedAt: 1 }],
      },
      pages: [{ ...OVERVIEW, rows: [] }],
    })
  )
  await screen.findByText("EMEA")

  await askQuestion("Sales?")
  await userEvent.click(
    await screen.findByRole("button", { name: "Add to a Page" })
  )
  await userEvent.click(
    await screen.findByRole("menuitem", { name: "Overview" })
  )

  expect(
    await screen.findByRole("heading", { name: "Totals", level: 2 })
  ).toBeTruthy()
  expect(
    await screen.findByRole("heading", { name: "Overview", level: 1 })
  ).toBeTruthy()
})

test("the chat beside a Page tells the AI which Page is open", async () => {
  const ask = vi.fn<(args: unknown) => unknown>(() => SALES_ANSWER)
  renderWorkspace(pageBackend({ ask }))
  await openOverview()
  await startNewChat()

  await askQuestion("Add a chart")

  await waitFor(() => expect(ask).toHaveBeenCalled())
  expect(ask.mock.calls[0][0]).toMatchObject({
    request: { activePage: "page-1" },
  })
})

test("a change from the AI shows on the Page straight away", async () => {
  const onRunPage = vi.fn()
  renderWorkspace(
    pageBackend({
      onRunPage,
      ask: (args) => {
        emit(args, {
          id: "page-1",
          kind: "page",
          status: "done",
          label: "Sales",
        })
        return new Promise(() => {})
      },
    })
  )
  await openOverview()
  await screen.findByText("That query failed.")
  await startNewChat()

  await askQuestion("Add a chart")

  await waitFor(() => expect(onRunPage).toHaveBeenCalledTimes(2))
})

test("a Page can't be edited while the AI works on it", async () => {
  renderWorkspace(pageBackend({ ask: () => new Promise(() => {}) }))
  await openOverview()
  await screen.findByText("That query failed.")
  await startEditing()
  await screen.findByRole("button", { name: "Remove Totals" })
  await startNewChat()

  await askQuestion("Add a chart")

  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Remove Totals" })).toBeNull()
  )
  expect(screen.getByRole("button", { name: "Edit" })).toHaveProperty(
    "disabled",
    true
  )
})

test("Undo brings back a removed block", async () => {
  renderWorkspace(pageBackend())
  await openOverview()
  await startEditing()

  await userEvent.click(
    await screen.findByRole("button", { name: "Remove Totals" })
  )
  expect(screen.queryByRole("heading", { name: "Totals" })).toBeNull()

  await userEvent.click(screen.getByRole("button", { name: "Undo" }))

  expect(await screen.findByRole("heading", { name: "Totals" })).toBeTruthy()
})

test("a block can be rebuilt from its settings without SQL", async () => {
  const onBuild = vi.fn()
  const onRunPage = vi.fn()
  renderWorkspace(pageBackend({ onBuild, onRunPage }))
  await openOverview()
  await startEditing()

  await userEvent.click(await screen.findByRole("heading", { name: "Totals" }))
  const settings = await screen.findByRole("complementary", {
    name: "Block settings",
  })
  await userEvent.click(
    within(settings).getByRole("button", { name: "Replace with choices" })
  )
  await userEvent.click(await within(settings).findByLabelText("Measure"))
  await userEvent.click(
    await screen.findByRole("option", { name: "Average of" })
  )

  await waitFor(() =>
    expect(onBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        table: "sales.csv",
        aggregate: "average",
        measure: "total",
      })
    )
  )
  await waitFor(() =>
    expect(blocksOf(onRunPage.mock.lastCall?.[0])[0].sql).toBe("SELECT built")
  )
})

test("a block can go to the AI with a question about it", async () => {
  const ask = vi.fn<(args: unknown) => unknown>(() => SALES_ANSWER)
  renderWorkspace(pageBackend({ ask }))
  await openOverview()
  await startEditing()

  await userEvent.click(await screen.findByRole("heading", { name: "Totals" }))
  await userEvent.click(
    await screen.findByRole("button", { name: "Ask AI to change this" })
  )
  expect(await screen.findByText("Changing Totals")).toBeTruthy()

  await askQuestion("Make it a bar chart")

  await waitFor(() => expect(ask).toHaveBeenCalled())
  expect(ask.mock.calls[0][0]).toMatchObject({
    request: { activePage: "page-1", activeBlock: "b1" },
  })
})

test("deleting a Page asks first and leaves the data", async () => {
  renderWorkspace(pageBackend())
  await openOverview()

  await userEvent.click(
    await screen.findByRole("button", { name: "Delete Overview" })
  )
  expect(screen.getByText("Delete this Page?")).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: "Delete Page" }))

  expect(await screen.findByText("No Page open")).toBeTruthy()
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

test("a follow-up carries the earlier answer and its queries", async () => {
  const ask = vi.fn<(args: unknown) => unknown>(() => SALES_ANSWER)
  await renderOpenTable(ask)

  await askQuestion("First?")
  await screen.findByRole("heading", { name: "Sales by region" })
  await askQuestion("Second?")
  await waitFor(() => expect(ask).toHaveBeenCalledTimes(2))

  expect(ask.mock.calls[1][0]).toMatchObject({
    project: "/docs/sales",
    request: {
      question: "Second?",
      activeTable: "sales.csv",
      history: [
        {
          question: "First?",
          answer: `Sales by region\nEMEA leads with ${(1500).toLocaleString()}.`,
          queries: [SALES_SQL],
        },
      ],
    },
  })
})

test("a number in an answer shows the query it came from", async () => {
  await renderOpenTable(() => SALES_ANSWER)

  await askQuestion("Sales?")
  const figure = (1500).toLocaleString()
  const number = await screen.findByRole("button", {
    name: `${figure}, show where this comes from`,
  })
  await userEvent.click(number)

  expect(
    await screen.findByText("From total, row 1 of this query")
  ).toBeTruthy()
  expect(screen.getAllByText(SALES_SQL).length).toBeGreaterThan(0)
})

test("a number the AI points at wrongly is never made up", async () => {
  await renderOpenTable(() => ({
    ...SALES_ANSWER,
    text: "It was {{q1.9.total}} and {{q7.0.total}}.",
  }))

  await askQuestion("Sales?")

  expect(await screen.findAllByText("missing value")).toHaveLength(2)
})

test("an answer can hold several figures", async () => {
  await renderOpenTable(() => ({
    ...SALES_ANSWER,
    figures: [
      { query: "q1", title: "By region", view: "bar", x: "region", y: "total" },
      { query: "q1", title: "All rows", view: "table", x: null, y: null },
    ],
  }))

  await askQuestion("Sales?")

  expect(await screen.findByRole("heading", { name: "By region" })).toBeTruthy()
  expect(screen.getByRole("heading", { name: "All rows" })).toBeTruthy()
})

test("the final text is not repeated as a working note", async () => {
  await renderOpenTable((args) => {
    const { onStep } = args as { onStep: { onmessage: (s: unknown) => void } }
    onStep.onmessage({
      id: "note-1",
      kind: "note",
      status: "done",
      label: "Note",
      detail: null,
      body: "Checking the regions first.",
    })
    onStep.onmessage({
      id: "note-2",
      kind: "note",
      status: "running",
      label: "Note",
      detail: null,
      body: "Sales by region\nEMEA leads with {{q1.0.total}}.",
    })
    return SALES_ANSWER
  })

  await askQuestion("Sales?")
  await screen.findByRole("heading", { name: "Sales by region" })
  await userEvent.click(screen.getByRole("button", { name: /Worked for/ }))

  expect(await screen.findByText("Checking the regions first.")).toBeTruthy()
  expect(screen.queryByText(/leads with …/)).toBeNull()
})

test("a query step shows exactly what the AI saw", async () => {
  await renderOpenTable((args) => {
    const { onStep } = args as { onStep: { onmessage: (s: unknown) => void } }
    onStep.onmessage({
      id: "run-q1",
      kind: "run",
      status: "done",
      label: "Compare regions",
      detail: "2 rows in 4 ms",
      body: SALES_SQL,
      query: "q1",
      sentRows: 1,
    })
    return SALES_ANSWER
  })

  await askQuestion("Sales?")
  await screen.findByRole("heading", { name: "Sales by region" })
  await userEvent.click(screen.getByRole("button", { name: /Worked for/ }))
  await userEvent.click(
    await screen.findByRole("button", { name: /Compare regions/ })
  )

  expect(
    await screen.findByText("The AI saw 1 row of this result")
  ).toBeTruthy()
})

function askAndWait(args: unknown) {
  const { onStep } = args as { onStep: { onmessage: (s: unknown) => void } }
  onStep.onmessage({
    id: "ask-1",
    kind: "question",
    status: "running",
    label: "Which year?",
    detail: null,
    body: null,
    options: ["2025", "2026"],
  })
  return new Promise(() => {})
}

test("a question from the AI can be answered with one click", async () => {
  const onReply = vi.fn()
  await renderOpenTable(askAndWait, undefined, { onReply })

  await askQuestion("Sales?")
  expect(await screen.findByText("Which year?")).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: "2026" }))

  expect(onReply).toHaveBeenCalledWith("2026")
})

test("a question from the AI can be answered by typing", async () => {
  const onReply = vi.fn()
  const ask = vi.fn(askAndWait)
  await renderOpenTable(ask, undefined, { onReply })

  await askQuestion("Sales?")
  await screen.findByText("Which year?")
  await askQuestion("Both years")

  await waitFor(() => expect(onReply).toHaveBeenCalledWith("Both years"))
  expect(ask).toHaveBeenCalledTimes(1)
})

test("Stop still works while the AI waits for a reply", async () => {
  const onStop = vi.fn()
  await renderOpenTable(askAndWait, onStop)

  await askQuestion("Sales?")
  await screen.findByText("Which year?")
  await userEvent.click(screen.getByRole("button", { name: "Stop" }))

  expect(onStop).toHaveBeenCalledWith(1)
})

test("a chat saved mid-answer reopens as interrupted and can be retried", async () => {
  const interrupted = {
    ...SAVED_CHAT,
    turns: [
      {
        id: 1,
        question: "Why?",
        startedAt: 1,
        steps: [
          {
            id: "run-q1",
            kind: "run",
            status: "running",
            label: "Compare regions",
            detail: null,
            body: "SELECT 1",
            startedAt: 1,
          },
        ],
      },
    ],
  }
  renderWorkspace(projectBackend({ saved: [interrupted] }))

  expect(
    await screen.findByText("Davis closed before this finished.")
  ).toBeTruthy()
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy()
  expect(await screen.findByRole("button", { name: "Send" })).toBeTruthy()
})

test("a chat saved in the earlier format still opens", async () => {
  const earlier = {
    ...SAVED_CHAT,
    turns: [
      {
        id: 1,
        question: "Sales?",
        startedAt: 1,
        finishedAt: 2,
        steps: [],
        answer: {
          title: "Earlier answer",
          sql: SALES_SQL,
          chart: { kind: "bar", x: "region", y: "total" },
          result: SALES_RESULT,
        },
      },
    ],
  }
  renderWorkspace(projectBackend({ saved: [earlier] }))

  expect(
    await screen.findByRole("heading", { name: "Earlier answer", level: 2 })
  ).toBeTruthy()
  expect(screen.getByRole("cell", { name: "1500" })).toBeTruthy()
})

test("one number is shown as the answer itself", async () => {
  await renderOpenTable(() => ({
    title: "Row count",
    text: "",
    figures: [{ query: "q1", title: "Rows", view: "number", x: null, y: null }],
    queries: {
      q1: {
        sql: "SELECT count(*) AS n FROM sales",
        result: {
          columns: [{ name: "n", dataType: "BIGINT", kind: "number" }],
          rows: [["2964624"]],
          isTruncated: false,
        },
      },
    },
  }))

  await askQuestion("How many?")

  expect(await screen.findByText((2964624).toLocaleString())).toBeTruthy()
  const chat = screen.getByRole("complementary", { name: "Ask AI" })
  expect(within(chat).queryByRole("table")).toBeNull()
})

test("an answer with no title shows just its text", async () => {
  const onSaveChat = vi.fn()
  await renderOpenTable(
    () => ({
      title: "",
      text: "I can't read that file.",
      figures: [],
      queries: {},
    }),
    undefined,
    { onSaveChat }
  )

  await askQuestion("Read my file")

  expect(await screen.findByText("I can't read that file.")).toBeTruthy()
  const chat = screen.getByRole("complementary", { name: "Ask AI" })
  expect(within(chat).getAllByRole("heading")).toHaveLength(1)
  await waitFor(() =>
    expect(onSaveChat.mock.lastCall?.[0]).toMatchObject({
      title: "Read my file",
    })
  )
})

test("an answer with no query still explains itself", async () => {
  await renderOpenTable(() => ({
    title: "This file has no date column",
    text: "",
    figures: [],
    queries: {},
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

  await userEvent.click(screen.getByRole("button", { name: "Settings" }))
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
  const chat = screen.getByRole("complementary", { name: "Ask AI" })
  expect(chat.closest("[inert]")).toBeNull()

  await userEvent.click(toggle)
  expect(toggle.getAttribute("aria-pressed")).toBe("false")
  expect(chat.closest("[inert]")).not.toBeNull()

  await userEvent.click(toggle)
  expect(toggle.getAttribute("aria-pressed")).toBe("true")
  expect(chat.closest("[inert]")).toBeNull()
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
