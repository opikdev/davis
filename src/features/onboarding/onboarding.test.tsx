import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, test, vi } from "vitest"

import type { ConnectionRequest, DetectedTools } from "@/features/ai-setup/api"
import { Onboarding } from "@/features/onboarding/onboarding"
import * as sound from "@/lib/sound/player"

const CLAUDE_SIGNED_IN = {
  id: "claude-code",
  installed: true,
  signedIn: true,
  account: { email: "ada@example.com", plan: "max" },
}

const NOTHING_FOUND: DetectedTools = {
  os: "macos",
  apps: [],
  localServers: [],
  hasNpm: true,
}

afterEach(() => {
  cleanup()
  clearMocks()
  vi.useRealTimers()
})

type Backend = {
  detect?: () => DetectedTools | Promise<DetectedTools>
  connect?: (request: ConnectionRequest) => unknown
  install?: (providerId: string, emit: (line: string) => void) => unknown
  signIn?: (providerId: string) => void
  disconnect?: (providerId: string) => void
}

function mockBackend({
  detect = () => NOTHING_FOUND,
  connect = ({ providerId }) => ({ providerId, account: null }),
  install = (id) => ({ id, installed: true, signedIn: null, account: null }),
  signIn = () => {},
  disconnect = () => {},
}: Backend = {}) {
  const connections: ConnectionRequest[] = []
  const calls: string[] = []
  mockIPC((command, payload) => {
    if (command === "detect_ai_tools") return detect()
    if (command === "connect_provider") {
      const { request } = payload as { request: ConnectionRequest }
      connections.push(request)
      return connect(request)
    }
    const { providerId, onOutput } = (payload ?? {}) as {
      providerId: string
      onOutput?: { onmessage: (line: string) => void }
    }
    calls.push(`${command}:${providerId}`)
    if (command === "install_app") {
      return install(providerId, (line) => onOutput?.onmessage(line))
    }
    if (command === "open_sign_in") return signIn(providerId)
    if (command === "disconnect_provider") return disconnect(providerId)
    throw new Error(`Unexpected command: ${command}`)
  })
  return { connections, calls }
}

async function openAiSetup(backend?: Backend) {
  const calls = mockBackend(backend)
  const onComplete = vi.fn()
  render(<Onboarding onComplete={onComplete} />)
  await userEvent.click(screen.getByRole("button", { name: "Get started" }))
  return { ...calls, onComplete }
}

function withApps(...apps: DetectedTools["apps"]): () => DetectedTools {
  return () => ({ ...NOTHING_FOUND, apps })
}

const CODEX_UNKNOWN = {
  id: "codex",
  installed: true,
  signedIn: null,
  account: null,
}

async function openAddDialog() {
  await userEvent.click(
    await screen.findByRole("button", { name: "Add another AI" })
  )
  return screen.findByRole("dialog")
}

async function openApiKeyList() {
  await userEvent.click(
    await screen.findByRole("button", { name: /^Use an API key/ })
  )
  return screen.findByRole("dialog")
}

async function openOpenAiForm() {
  const dialog = await openApiKeyList()
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Connect OpenAI" })
  )
  await within(dialog).findByLabelText("API key")
  return dialog
}

async function submitKey(dialog: HTMLElement, key: string) {
  await userEvent.type(within(dialog).getByLabelText("API key"), key)
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Connect OpenAI" })
  )
}

test("starts checking for AI tools while the welcome screen is showing", async () => {
  let detections = 0
  mockBackend({
    detect: () => {
      detections += 1
      return NOTHING_FOUND
    },
  })

  render(<Onboarding onComplete={vi.fn()} />)

  await waitFor(() => expect(detections).toBe(1))
  expect(screen.getByRole("button", { name: "Get started" })).toBeTruthy()
})

test("moves focus to the new heading", async () => {
  await openAiSetup()

  await waitFor(() =>
    expect((document.activeElement as HTMLElement).tagName).toBe("H1")
  )
})

test("finishes without AI when the user skips", async () => {
  const { onComplete } = await openAiSetup()

  await userEvent.click(
    await screen.findByRole("button", { name: "Skip for now" })
  )

  expect(onComplete).toHaveBeenCalledOnce()
})

test("says the user is ready when a tool is already signed in", async () => {
  const { connections, onComplete } = await openAiSetup({
    detect: withApps(CLAUDE_SIGNED_IN),
  })

  expect(
    await screen.findByRole("heading", { name: "You're ready" })
  ).toBeTruthy()
  expect(screen.getByText(/Davis can use Claude Code\./)).toBeTruthy()
  expect(screen.getByText("ada@example.com · Max")).toBeTruthy()
  await waitFor(() => expect(connections).toHaveLength(1))

  await userEvent.click(
    screen.getByRole("button", { name: "Start using Davis" })
  )
  expect(onComplete).toHaveBeenCalledOnce()
})

test("names every connected tool", async () => {
  await openAiSetup({
    detect: () => ({
      ...NOTHING_FOUND,
      apps: [CLAUDE_SIGNED_IN, { ...CLAUDE_SIGNED_IN, id: "codex" }],
      localServers: ["ollama"],
    }),
  })

  expect(
    await screen.findByText(/Davis can use Ollama, Claude Code, and Codex\./)
  ).toBeTruthy()
})

test("leaves unfinished tools out of the ready screen", async () => {
  await openAiSetup({ detect: withApps(CLAUDE_SIGNED_IN, CODEX_UNKNOWN) })
  await screen.findByRole("heading", { name: "You're ready" })

  expect(screen.queryByText("Codex")).toBeNull()

  const dialog = await openAddDialog()

  expect(within(dialog).getByText("Codex")).toBeTruthy()
})

test("lists found tools first in the add dialog", async () => {
  await openAiSetup({
    detect: withApps({ ...CODEX_UNKNOWN, id: "opencode" }),
  })
  const dialog = await openAddDialog()

  expect(
    within(within(dialog).getAllByRole("listitem")[0]).getByText("OpenCode")
  ).toBeTruthy()
})

test("does not show the catalog to someone who is ready", async () => {
  await openAiSetup({ detect: withApps(CLAUDE_SIGNED_IN) })
  await screen.findByRole("heading", { name: "You're ready" })

  expect(screen.getAllByRole("listitem")).toHaveLength(1)
  expect(screen.queryByText("OpenAI")).toBeNull()
  expect(screen.queryByRole("button", { name: /^Use an API key/ })).toBeNull()
})

test("connects a running local model without a click", async () => {
  const { connections } = await openAiSetup({
    detect: () => ({ ...NOTHING_FOUND, localServers: ["ollama"] }),
  })

  expect(
    await screen.findByRole("heading", { name: "You're ready" })
  ).toBeTruthy()
  expect(screen.getByText("Running on this computer")).toBeTruthy()
  expect(connections.map(({ providerId }) => providerId)).toEqual(["ollama"])
})

test("offers sign-in when an automatic connection finds the tool signed out", async () => {
  await openAiSetup({
    detect: withApps(CLAUDE_SIGNED_IN),
    connect: () => {
      throw { kind: "not-signed-in", message: "signed out" }
    },
  })

  expect(
    await screen.findByRole("button", { name: "Sign in to Claude Code" })
  ).toBeTruthy()
  expect(
    screen.queryByRole("button", { name: "Connect Claude Code" })
  ).toBeNull()
  expect(screen.getByRole("heading", { name: "Connect an AI" })).toBeTruthy()
})

test("disconnecting stays disconnected until the user reconnects", async () => {
  const { calls, connections } = await openAiSetup({
    detect: withApps(CLAUDE_SIGNED_IN),
  })

  await userEvent.click(
    await screen.findByRole("button", { name: "Disconnect Claude Code" })
  )

  expect(calls).toContain("disconnect_provider:claude-code")
  expect(
    await screen.findByRole("heading", { name: "Connect an AI" })
  ).toBeTruthy()

  const dialog = await openAddDialog()
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Install Codex" })
  )
  await within(dialog).findByText("Connected")

  expect(
    connections.filter(({ providerId }) => providerId === "claude-code")
  ).toHaveLength(1)
})

test("offers three plain choices when nothing is found", async () => {
  await openAiSetup()

  expect(
    await screen.findByRole("heading", { name: "Connect an AI" })
  ).toBeTruthy()
  expect(screen.getByRole("button", { name: /^Use an AI tool/ })).toBeTruthy()
  expect(screen.getByRole("button", { name: /^Use an API key/ })).toBeTruthy()
  expect(
    screen.getByRole("button", { name: /^Run AI on this computer/ })
  ).toBeTruthy()
  expect(screen.queryByRole("listitem")).toBeNull()
})

test("searches every provider from one box", async () => {
  await openAiSetup({ detect: withApps(CODEX_UNKNOWN) })
  const dialog = await openAddDialog()

  await userEvent.type(
    within(dialog).getByRole("textbox", { name: "Search for an AI" }),
    "open"
  )

  expect(within(dialog).getByText("OpenAI")).toBeTruthy()
  expect(within(dialog).getByText("OpenCode")).toBeTruthy()
  expect(within(dialog).getByText("OpenRouter")).toBeTruthy()
  expect(within(dialog).queryByText("Anthropic")).toBeNull()
})

test("offers a custom URL when a search finds nothing", async () => {
  await openAiSetup({ detect: withApps(CODEX_UNKNOWN) })
  const dialog = await openAddDialog()

  await userEvent.type(
    within(dialog).getByRole("textbox", { name: "Search for an AI" }),
    "zzz"
  )

  expect(within(dialog).getByText('No results for "zzz"')).toBeTruthy()

  await userEvent.click(
    within(dialog).getByRole("button", { name: "Use a custom URL" })
  )

  expect(
    await within(dialog).findByRole("heading", {
      name: "Connect a custom URL",
    })
  ).toBeTruthy()
})

test("clears the search and returns focus to it", async () => {
  await openAiSetup({ detect: withApps(CODEX_UNKNOWN) })
  const dialog = await openAddDialog()
  const search = within(dialog).getByRole("textbox", {
    name: "Search for an AI",
  }) as HTMLInputElement

  expect(
    within(dialog).queryByRole("button", { name: "Clear search" })
  ).toBeNull()

  await userEvent.type(search, "open")
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Clear search" })
  )

  expect(search.value).toBe("")
  expect(document.activeElement).toBe(search)
  expect(
    within(dialog).queryByRole("button", { name: "Clear search" })
  ).toBeNull()
  expect(within(dialog).getByText("Anthropic")).toBeTruthy()
})

test("shows live progress while installing, then connects", async () => {
  let finishInstall = () => {}
  const { connections, calls } = await openAiSetup({
    install: (id, emit) =>
      new Promise((resolve) => {
        emit("added 12 packages")
        finishInstall = () =>
          resolve({ id, installed: true, signedIn: true, account: null })
      }),
  })
  await userEvent.click(
    await screen.findByRole("button", { name: /^Use an AI tool/ })
  )
  const dialog = await screen.findByRole("dialog")

  await userEvent.click(
    within(dialog).getByRole("button", { name: "Install Claude Code" })
  )

  expect(await within(dialog).findByText("added 12 packages")).toBeTruthy()
  expect(calls).toContain("install_app:claude-code")

  finishInstall()

  expect(await within(dialog).findByText("Connected")).toBeTruthy()
  expect(connections).toHaveLength(1)
})

test("keeps an install visible after the dialog closes", async () => {
  await openAiSetup({
    install: (_id, emit) =>
      new Promise(() => {
        emit("added 12 packages")
      }),
  })
  await userEvent.click(
    await screen.findByRole("button", { name: /^Use an AI tool/ })
  )
  const dialog = await screen.findByRole("dialog")
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Install Codex" })
  )
  await within(dialog).findByText("added 12 packages")

  await userEvent.keyboard("{Escape}")

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  expect(screen.getByText("added 12 packages")).toBeTruthy()
})

test("asks to sign in after installing a signed-out app", async () => {
  let isInstalled = false
  const { connections } = await openAiSetup({
    detect: () =>
      isInstalled
        ? withApps({ ...CLAUDE_SIGNED_IN, signedIn: false, account: null })()
        : NOTHING_FOUND,
    install: (id) => {
      isInstalled = true
      return { id, installed: true, signedIn: false, account: null }
    },
  })
  await userEvent.click(
    await screen.findByRole("button", { name: /^Use an AI tool/ })
  )
  const dialog = await screen.findByRole("dialog")

  await userEvent.click(
    within(dialog).getByRole("button", { name: "Install Claude Code" })
  )

  expect(
    await within(dialog).findByRole("button", {
      name: "Sign in to Claude Code",
    })
  ).toBeTruthy()
  expect(connections).toHaveLength(0)
})

test("explains a failed install and offers the command to copy", async () => {
  await openAiSetup({
    install: () => {
      throw { kind: "install-failed", message: "no network" }
    },
  })
  await userEvent.click(
    await screen.findByRole("button", { name: /^Use an AI tool/ })
  )
  const dialog = await screen.findByRole("dialog")

  await userEvent.click(
    within(dialog).getByRole("button", { name: "Install Codex" })
  )

  expect((await within(dialog).findByRole("alert")).textContent).toBe(
    "Codex didn't install. Check your connection and try again, or run this command in Terminal:"
  )
  expect(
    within(dialog).getByDisplayValue("npm install -g @openai/codex")
  ).toBeTruthy()
})

test("signs in through Terminal, then connects by itself", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  let signedIn = false
  const { calls } = await openAiSetup({
    detect: () => withApps({ ...CLAUDE_SIGNED_IN, signedIn })(),
  })

  await userEvent.click(
    await screen.findByRole("button", { name: "Sign in to Claude Code" })
  )

  expect(calls).toContain("open_sign_in:claude-code")
  expect(
    await screen.findByText("Finish signing in, then come back")
  ).toBeTruthy()

  signedIn = true
  await vi.advanceTimersByTimeAsync(3100)

  expect(
    await screen.findByRole("heading", { name: "You're ready" })
  ).toBeTruthy()
})

test("shows one button when sign-in can't be read, and never claims Connected", async () => {
  const { connections } = await openAiSetup({
    detect: withApps(CODEX_UNKNOWN),
    connect: () => {
      throw { kind: "check-failed", message: "timed out" }
    },
  })

  await userEvent.click(
    await screen.findByRole("button", { name: "Connect Codex" })
  )

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Davis couldn't check Codex. Try again."
  )
  expect(screen.queryByRole("button", { name: "Sign in to Codex" })).toBeNull()
  expect(screen.queryByText("Connected")).toBeNull()
  expect(connections).toHaveLength(1)
})

test("offers a download when npm is needed but missing", async () => {
  await openAiSetup({
    detect: () => ({ ...NOTHING_FOUND, hasNpm: false }),
  })
  await userEvent.click(
    await screen.findByRole("button", { name: /^Use an AI tool/ })
  )
  const dialog = await screen.findByRole("dialog")

  expect(within(dialog).getByRole("button", { name: "Get Codex" })).toBeTruthy()
  expect(
    within(dialog).getByRole("button", { name: "Install Claude Code" })
  ).toBeTruthy()
})

test("shows the command to copy when Terminal can't open", async () => {
  await openAiSetup({
    detect: withApps({ ...CLAUDE_SIGNED_IN, signedIn: false, account: null }),
    signIn: () => {
      throw { kind: "terminal", message: "no terminal" }
    },
  })

  await userEvent.click(
    await screen.findByRole("button", { name: "Sign in to Claude Code" })
  )

  expect(await screen.findByDisplayValue("claude auth login")).toBeTruthy()
  expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy()
})

test("only asks for a local model's address after connecting fails", async () => {
  let isRunning = false
  const { connections } = await openAiSetup({
    connect: ({ providerId }) => {
      if (!isRunning) throw { kind: "unreachable", message: "unreachable" }
      return { providerId, account: null }
    },
  })
  await userEvent.click(
    await screen.findByRole("button", { name: /^Run AI on this computer/ })
  )
  const list = await screen.findByRole("dialog")

  await userEvent.click(
    within(list).getByRole("button", { name: "Connect Ollama" })
  )

  const dialog = await screen.findByRole("dialog")
  expect((await within(dialog).findByRole("alert")).textContent).toBe(
    "Can't reach Ollama. Open Ollama, then try again."
  )
  expect(connections[0].url).toBeUndefined()

  isRunning = true
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Connect Ollama" })
  )

  expect(
    await screen.findByRole("heading", { name: "You're ready" })
  ).toBeTruthy()
  expect(connections[1].url).toBe("http://localhost:11434")
})

test("connects with an API key and returns to the short list", async () => {
  const { connections } = await openAiSetup()

  await submitKey(await openOpenAiForm(), "sk-test-key")

  expect(
    await screen.findByRole("heading", { name: "You're ready" })
  ).toBeTruthy()
  expect(screen.queryByRole("dialog")).toBeNull()
  expect(screen.getByText("OpenAI")).toBeTruthy()
  expect(connections).toEqual([
    { providerId: "openai", apiKey: "sk-test-key", url: undefined },
  ])
})

test("explains a rejected key and lets the user retry", async () => {
  let attempts = 0
  await openAiSetup({
    connect: ({ providerId }) => {
      attempts += 1
      if (attempts === 1) throw { kind: "rejected-key", message: "rejected" }
      return { providerId, account: null }
    },
  })
  const dialog = await openOpenAiForm()

  await submitKey(dialog, "wrong-key")

  expect((await within(dialog).findByRole("alert")).textContent).toBe(
    "This key didn't work with OpenAI. Check that you copied all of it, then try again."
  )

  await userEvent.click(
    within(dialog).getByRole("button", { name: "Connect OpenAI" })
  )

  expect(
    await screen.findByRole("heading", { name: "You're ready" })
  ).toBeTruthy()
})

test("leaving the form leaves no error behind", async () => {
  await openAiSetup({
    connect: () => {
      throw { kind: "busy", message: "busy" }
    },
  })
  const dialog = await openOpenAiForm()
  await submitKey(dialog, "sk-test-key")
  await within(dialog).findByRole("alert")

  await userEvent.click(within(dialog).getByRole("button", { name: "Back" }))

  expect(within(dialog).queryByRole("alert")).toBeNull()
})

test("does not submit an empty required key", async () => {
  const { connections } = await openAiSetup()
  const dialog = await openOpenAiForm()

  await userEvent.click(
    within(dialog).getByRole("button", { name: "Connect OpenAI" })
  )

  expect(connections).toHaveLength(0)
})

test("does not call a custom address by its menu name", async () => {
  await openAiSetup()
  await userEvent.click(
    await screen.findByRole("button", { name: /^See all options/ })
  )
  const dialog = await screen.findByRole("dialog")

  await userEvent.click(
    within(dialog).getByRole("button", { name: "Connect Custom URL" })
  )

  expect(
    await within(dialog).findByRole("heading", {
      name: "Connect a custom URL",
    })
  ).toBeTruthy()
  expect(within(dialog).getByText(/only sent to this address/)).toBeTruthy()
})

async function openKeyForm(backend?: Backend) {
  const result = await openAiSetup({
    detect: withApps(CLAUDE_SIGNED_IN),
    ...backend,
  })
  const dialog = await openAddDialog()
  await userEvent.type(
    within(dialog).getByRole("textbox", { name: "Search for an AI" }),
    "openai"
  )
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Connect OpenAI" })
  )
  return { ...result, dialog }
}

test("asks for a missing key on the field without calling the provider", async () => {
  const { connections, dialog } = await openKeyForm()
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Connect OpenAI" })
  )

  const field = within(dialog).getByLabelText("API key") as HTMLInputElement
  expect(within(dialog).getByRole("alert").textContent).toBe(
    "Enter your API key."
  )
  expect(field.getAttribute("aria-invalid")).toBe("true")
  expect(document.activeElement).toBe(field)
  expect(connections.map(({ providerId }) => providerId)).not.toContain(
    "openai"
  )
})

test("attaches a rejected key to its field and clears it while typing", async () => {
  const { dialog } = await openKeyForm({
    connect: () => {
      throw { kind: "rejected-key", message: "no" }
    },
  })
  const field = within(dialog).getByLabelText("API key") as HTMLInputElement
  await userEvent.type(field, "wrong")
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Connect OpenAI" })
  )

  const error = await within(dialog).findByRole("alert")
  expect(field.getAttribute("aria-invalid")).toBe("true")
  expect(field.getAttribute("aria-describedby")).toContain(error.id)
  expect(document.activeElement).toBe(field)

  await userEvent.type(field, "x")

  expect(within(dialog).queryByRole("alert")).toBeNull()
  expect(field.getAttribute("aria-invalid")).toBe("false")
})

test("checks an address when the user leaves it, and clears once fixed", async () => {
  await openAiSetup({ detect: withApps(CLAUDE_SIGNED_IN) })
  const dialog = await openAddDialog()
  await userEvent.type(
    within(dialog).getByRole("textbox", { name: "Search for an AI" }),
    "zzz"
  )
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Use a custom URL" })
  )
  const address = await within(dialog).findByLabelText("Address")

  await userEvent.type(address, "local")
  expect(address.getAttribute("aria-invalid")).toBe("false")

  await userEvent.tab()
  expect(within(dialog).getByRole("alert").textContent).toBe(
    "Enter a full address, like https://example.com."
  )

  await userEvent.clear(address)
  await userEvent.type(address, "http://localhost:1234")
  expect(within(dialog).queryByRole("alert")).toBeNull()
})

test("moves focus into the form, and back to search", async () => {
  const { dialog } = await openKeyForm()

  expect(document.activeElement).toBe(within(dialog).getByLabelText("API key"))

  await userEvent.click(within(dialog).getByRole("button", { name: "Back" }))

  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Search for an AI" })
    )
  )
})

test("keeps focus on the submit button while connecting", async () => {
  let finish = () => {}
  const { dialog } = await openKeyForm({
    connect: () =>
      new Promise((resolve) => {
        finish = () => resolve({ providerId: "openai", account: null })
      }),
  })
  await userEvent.type(within(dialog).getByLabelText("API key"), "key")
  const submit = within(dialog).getByRole("button", { name: "Connect OpenAI" })
  await userEvent.click(submit)

  expect(submit.getAttribute("aria-disabled")).toBe("true")
  expect(submit.hasAttribute("disabled")).toBe(false)
  expect(document.activeElement).toBe(submit)

  finish()
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
})

test("keeps keyboard focus in the row when an action replaces the button", async () => {
  await openAiSetup({ detect: withApps(CLAUDE_SIGNED_IN) })
  await screen.findByRole("heading", { name: "You're ready" })
  await userEvent.click(
    await screen.findByRole("button", { name: "Disconnect Claude Code" })
  )

  await waitFor(() =>
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Connect Claude Code"
    )
  )
})

test("announces a row's result to screen readers", async () => {
  await openAiSetup({ detect: withApps(CLAUDE_SIGNED_IN) })

  expect(await screen.findByText("Claude Code connected")).toBeTruthy()
})

test("lets the user cancel waiting for sign-in", async () => {
  await openAiSetup({
    detect: withApps({ ...CLAUDE_SIGNED_IN, signedIn: false }),
  })
  await userEvent.click(
    await screen.findByRole("button", { name: "Sign in to Claude Code" })
  )
  await userEvent.click(
    await screen.findByRole("button", { name: "Cancel Claude Code sign-in" })
  )

  expect(
    await screen.findByRole("button", { name: "Sign in to Claude Code" })
  ).toBeTruthy()
  expect(screen.queryByText("Finish signing in, then come back")).toBeNull()
})

test("remembers an install and a disconnect across Back", async () => {
  let finishInstall = () => {}
  await openAiSetup({
    detect: withApps(CLAUDE_SIGNED_IN),
    install: (id) =>
      new Promise((resolve) => {
        finishInstall = () =>
          resolve({ id, installed: true, signedIn: false, account: null })
      }),
  })
  await userEvent.click(
    await screen.findByRole("button", { name: "Disconnect Claude Code" })
  )
  const dialog = await openAddDialog()
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Install Codex" })
  )
  await userEvent.keyboard("{Escape}")
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

  await userEvent.click(screen.getByRole("button", { name: "Back" }))
  await userEvent.click(screen.getByRole("button", { name: "Get started" }))

  expect(await screen.findByText("Installing…")).toBeTruthy()
  expect(screen.queryByText("Claude Code connected")).toBeNull()
  finishInstall()
})

test("resets the copy button after a moment", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: () => Promise.resolve() },
  })
  await openAiSetup({
    install: () => {
      throw { kind: "install-failed", message: "no network" }
    },
  })
  await userEvent.click(
    await screen.findByRole("button", { name: /^Use an AI tool/ })
  )
  const dialog = await screen.findByRole("dialog")
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Install Codex" })
  )
  await userEvent.click(
    await within(dialog).findByRole("button", { name: "Copy" })
  )

  expect(within(dialog).getByRole("button", { name: "Copied" })).toBeTruthy()
  await vi.advanceTimersByTimeAsync(2100)

  expect(
    await within(dialog).findByRole("button", { name: "Copy" })
  ).toBeTruthy()
})

test("sounds a success when the user connects, not for automatic connections", async () => {
  const played = vi.spyOn(sound, "playSound")
  await openAiSetup({ detect: withApps(CLAUDE_SIGNED_IN) })
  await screen.findByRole("heading", { name: "You're ready" })
  expect(played).not.toHaveBeenCalledWith("success")

  const dialog = await openAddDialog()
  await userEvent.type(
    within(dialog).getByRole("textbox", { name: "Search for an AI" }),
    "openai"
  )
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Connect OpenAI" })
  )
  await userEvent.type(within(dialog).getByLabelText("API key"), "key")
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Connect OpenAI" })
  )

  await waitFor(() => expect(played).toHaveBeenCalledWith("success"))
  played.mockRestore()
})

test("sounds a success when a sign-in finishes", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const played = vi.spyOn(sound, "playSound")
  let signedIn = false
  await openAiSetup({
    detect: () => withApps({ ...CLAUDE_SIGNED_IN, signedIn })(),
  })
  await userEvent.click(
    await screen.findByRole("button", { name: "Sign in to Claude Code" })
  )
  signedIn = true
  await vi.advanceTimersByTimeAsync(3100)

  await waitFor(() => expect(played).toHaveBeenCalledWith("success"))
  played.mockRestore()
})

test("sounds an error when a key is missing", async () => {
  const played = vi.spyOn(sound, "playSound")
  const { dialog } = await openKeyForm()
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Connect OpenAI" })
  )

  expect(played).toHaveBeenCalledWith("error")
  played.mockRestore()
})

test("turning sound effects off is remembered", async () => {
  await openAiSetup()
  const toggle = screen.getByRole("button", { name: "Sound effects" })
  expect(toggle.getAttribute("aria-pressed")).toBe("true")

  await userEvent.click(toggle)

  expect(toggle.getAttribute("aria-pressed")).toBe("false")
  expect(sound.isSoundOn()).toBe(false)
  sound.setSoundOn(true)
})

test("a failure stays visible after the dialog closes", async () => {
  let failInstall: (error: unknown) => void = () => {}
  await openAiSetup({
    detect: withApps(CLAUDE_SIGNED_IN),
    install: () =>
      new Promise((_, reject) => {
        failInstall = reject
      }),
  })
  const dialog = await openAddDialog()
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Install Codex" })
  )
  await userEvent.keyboard("{Escape}")
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

  failInstall({ kind: "install-failed", message: "no network" })

  expect((await screen.findByRole("alert")).textContent).toContain(
    "Codex didn't install."
  )
  expect(screen.getByRole("heading", { name: "You're ready" })).toBeTruthy()
})

test("a disconnect that fails says so", async () => {
  const played = vi.spyOn(sound, "playSound")
  await openAiSetup({
    detect: withApps(CLAUDE_SIGNED_IN, {
      ...CLAUDE_SIGNED_IN,
      id: "codex",
    }),
    disconnect: () => {
      throw { kind: "keychain", message: "locked" }
    },
  })
  await userEvent.click(
    await screen.findByRole("button", { name: "Disconnect Codex" })
  )

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Davis couldn't disconnect Codex. Check that your keychain is unlocked, then try again."
  )
  expect(played).toHaveBeenCalledWith("error")
  played.mockRestore()
})

test("every failed local connect shows its error on the address", async () => {
  await openAiSetup({
    detect: withApps(CLAUDE_SIGNED_IN),
    connect: ({ providerId }) => {
      if (providerId === "claude-code") {
        return { providerId, account: null }
      }
      throw { kind: "unreachable", message: "x" }
    },
  })
  const dialog = await openAddDialog()
  const connectOllama = () =>
    within(dialog).getByRole("button", { name: "Connect Ollama" })

  await userEvent.click(connectOllama())
  const address = await within(dialog).findByLabelText("Address")
  expect(address.getAttribute("aria-invalid")).toBe("true")
  await userEvent.click(within(dialog).getByRole("button", { name: "Back" }))

  await userEvent.click(connectOllama())

  expect(
    (await within(dialog).findByLabelText("Address")).getAttribute(
      "aria-invalid"
    )
  ).toBe("true")
  expect(within(dialog).getByRole("alert").textContent).toContain(
    "Can't reach Ollama."
  )
})

test("a server's address error stays until the address changes", async () => {
  await openAiSetup({
    detect: withApps(CLAUDE_SIGNED_IN),
    connect: ({ providerId }) => {
      if (providerId === "claude-code") {
        return { providerId, account: null }
      }
      throw { kind: "bad-address", message: "x" }
    },
  })
  const dialog = await openAddDialog()
  await userEvent.type(
    within(dialog).getByRole("textbox", { name: "Search for an AI" }),
    "zzz"
  )
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Use a custom URL" })
  )
  const address = await within(dialog).findByLabelText("Address")
  await userEvent.type(address, "http://localhost:1")
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Connect a custom URL" })
  )
  await within(dialog).findByRole("alert")

  await userEvent.tab()

  expect(within(dialog).getByRole("alert").textContent).toBe(
    "Nothing answered at this address. Check it, then try again."
  )
})

test("a late result can't undo a disconnect", async () => {
  const order: string[] = []
  let finishSave = () => {}
  await openAiSetup({
    detect: withApps(CLAUDE_SIGNED_IN),
    connect: () =>
      new Promise((resolve) => {
        finishSave = () => {
          order.push("saved")
          resolve({ providerId: "claude-code", account: null })
        }
      }),
    disconnect: () => {
      order.push("removed")
    },
  })
  await userEvent.click(
    await screen.findByRole("button", { name: "Disconnect Claude Code" })
  )
  expect(order).toEqual([])

  finishSave()

  await waitFor(() => expect(order).toEqual(["saved", "removed"]))
})

test("a late failure doesn't replace a disconnected row", async () => {
  let failSave: (error: unknown) => void = () => {}
  const { calls } = await openAiSetup({
    detect: withApps(CLAUDE_SIGNED_IN),
    connect: () =>
      new Promise((_, reject) => {
        failSave = reject
      }),
  })
  await userEvent.click(
    await screen.findByRole("button", { name: "Disconnect Claude Code" })
  )

  failSave({ kind: "busy", message: "x" })
  await waitFor(() =>
    expect(calls).toContain("disconnect_provider:claude-code")
  )

  expect(screen.queryByRole("alert")).toBeNull()
})

test("a finished sign-in doesn't pull focus out of the dialog", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  let signedIn = false
  await openAiSetup({
    detect: () =>
      withApps(
        { ...CLAUDE_SIGNED_IN, signedIn },
        { ...CLAUDE_SIGNED_IN, id: "codex" }
      )(),
  })
  const dialog = await openAddDialog()
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Sign in to Claude Code" })
  )
  const search = within(dialog).getByRole("textbox", {
    name: "Search for an AI",
  })
  await userEvent.type(search, "c")

  signedIn = true
  await vi.advanceTimersByTimeAsync(3100)

  expect(
    (await screen.findAllByText("Claude Code connected")).length
  ).toBeGreaterThan(0)
  expect(document.activeElement).toBe(search)
})

test("each sign-in gets its own full wait", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const notSignedIn = (id: string) => ({
    ...CLAUDE_SIGNED_IN,
    id,
    signedIn: false,
  })
  await openAiSetup({
    detect: withApps(notSignedIn("claude-code"), notSignedIn("codex")),
  })
  await userEvent.click(
    await screen.findByRole("button", { name: "Sign in to Claude Code" })
  )
  await vi.advanceTimersByTimeAsync(9 * 60 * 1000)
  await userEvent.click(
    await screen.findByRole("button", { name: "Sign in to Codex" })
  )
  await vi.advanceTimersByTimeAsync(2 * 60 * 1000)

  expect(
    await screen.findByRole("button", { name: "Sign in to Claude Code" })
  ).toBeTruthy()
  expect(
    screen.getByRole("button", { name: "Cancel Codex sign-in" })
  ).toBeTruthy()
})

test("waits for a slow check to finish before polling again", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  let detections = 0
  let isFirst = true
  await openAiSetup({
    detect: () => {
      if (isFirst) {
        isFirst = false
        return withApps({ ...CLAUDE_SIGNED_IN, signedIn: false })()
      }
      detections += 1
      return new Promise(() => {})
    },
  })
  await userEvent.click(
    await screen.findByRole("button", { name: "Sign in to Claude Code" })
  )
  await vi.advanceTimersByTimeAsync(20_000)

  expect(detections).toBe(1)
})

test("an older check can't overwrite a newer one", async () => {
  const answers: ((tools: DetectedTools) => void)[] = []
  let isFirst = true
  const installedCodex = { ...CLAUDE_SIGNED_IN, id: "codex", signedIn: null }
  await openAiSetup({
    detect: () => {
      if (isFirst) {
        isFirst = false
        return withApps(CLAUDE_SIGNED_IN)()
      }
      return new Promise((resolve) => {
        answers.push(resolve)
      })
    },
  })
  const dialog = await openAddDialog()
  window.dispatchEvent(new Event("focus"))
  window.dispatchEvent(new Event("focus"))

  answers[1](withApps(CLAUDE_SIGNED_IN, installedCodex)())
  await within(dialog).findByRole("button", { name: "Connect Codex" })

  answers[0](withApps(CLAUDE_SIGNED_IN)())
  await new Promise((resolve) => setTimeout(resolve))

  expect(
    within(dialog).getByRole("button", { name: "Connect Codex" })
  ).toBeTruthy()
})

test("notices a sign-in finished outside Davis when the window regains focus", async () => {
  let signedIn = false
  await openAiSetup({
    detect: () => withApps({ ...CLAUDE_SIGNED_IN, signedIn })(),
  })
  await screen.findByRole("button", { name: "Sign in to Claude Code" })

  signedIn = true
  window.dispatchEvent(new Event("focus"))

  expect(await screen.findByText("Claude Code connected")).toBeTruthy()
})

test("offers the Windows installer on Windows", async () => {
  await openAiSetup({
    detect: () => ({ ...NOTHING_FOUND, os: "windows", hasNpm: false }),
    install: () => {
      throw { kind: "install-failed", message: "x" }
    },
  })
  await userEvent.click(
    await screen.findByRole("button", { name: /^Use an AI tool/ })
  )
  const dialog = await screen.findByRole("dialog")

  await userEvent.click(
    within(dialog).getByRole("button", { name: "Install Claude Code" })
  )

  expect(
    await within(dialog).findByDisplayValue(
      "irm https://claude.ai/install.ps1 | iex"
    )
  ).toBeTruthy()
  expect(
    within(dialog).getByRole("button", { name: "Get OpenCode" })
  ).toBeTruthy()
})

test("offers a Unix install that needs no npm elsewhere", async () => {
  await openAiSetup({
    detect: () => ({ ...NOTHING_FOUND, os: "linux", hasNpm: false }),
  })
  await userEvent.click(
    await screen.findByRole("button", { name: /^Use an AI tool/ })
  )
  const dialog = await screen.findByRole("dialog")

  expect(
    within(dialog).getByRole("button", { name: "Install OpenCode" })
  ).toBeTruthy()
})
