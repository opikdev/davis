import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const IDENTIFIER = "dev.opik.davis"
const isWindows = process.platform === "win32"
const application = path.resolve(
  here,
  "../target/debug",
  isWindows ? "davis.exe" : "davis"
)
const DEBUG_PORT = 9222
const DRIVER_PORT = 4444
const START_TIMEOUT_MS = 60000

const children = []
let isClosing = false

function configFolder() {
  if (isWindows) {
    return path.join(process.env.APPDATA, IDENTIFIER)
  }
  const base = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config")
  return path.join(base, IDENTIFIER)
}

// Seeding replaces Davis settings, so it only runs on throwaway CI machines.
function seedProject() {
  if (!process.env.CI) {
    throw new Error(
      "The end-to-end tests replace Davis settings, so they only run in CI."
    )
  }
  const project = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "davis-e2e-")),
    "Sales"
  )
  for (const folder of ["data", "chats", "pages"]) {
    fs.mkdirSync(path.join(project, folder), { recursive: true })
  }
  fs.writeFileSync(
    path.join(project, "project.json"),
    JSON.stringify({ version: 1 })
  )
  fs.copyFileSync(
    path.join(here, "fixtures", "sales.csv"),
    path.join(project, "data", "sales.csv")
  )
  const config = configFolder()
  fs.mkdirSync(config, { recursive: true })
  fs.writeFileSync(
    path.join(config, "settings.json"),
    JSON.stringify({ onboardingComplete: true })
  )
  fs.writeFileSync(
    path.join(config, "recent-projects.json"),
    JSON.stringify({ projects: [project] })
  )
}

function start(command, args, env = process.env) {
  const child = spawn(command, args, {
    env,
    stdio: [null, process.stdout, process.stderr],
  })
  child.on("error", (error) => {
    console.error(`${command} failed to start:`, error)
    process.exit(1)
  })
  child.on("exit", (code) => {
    if (!isClosing) {
      console.error(`${command} exited with code`, code)
      process.exit(1)
    }
  })
  children.push(child)
}

async function waitForUrl(url) {
  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    const isUp = await fetch(url).then(
      (response) => response.ok,
      () => false
    )
    if (isUp) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`${url} didn't answer within ${START_TIMEOUT_MS / 1000}s`)
}

// On Windows, tauri-driver never got a WebView2 session in CI (DevToolsActivePort
// error), so Davis opens a debugging port and the Edge driver attaches to it.
async function startDrivers() {
  if (!isWindows) {
    start("tauri-driver", [])
    return
  }
  start(application, [], {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${DEBUG_PORT}`,
  })
  await waitForUrl(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
  start("msedgedriver", [`--port=${DRIVER_PORT}`])
  await waitForUrl(`http://127.0.0.1:${DRIVER_PORT}/status`)
}

function stopAll() {
  isClosing = true
  for (const child of children) child.kill()
}

const capability = isWindows
  ? {
      browserName: "webview2",
      "ms:edgeOptions": { debuggerAddress: `127.0.0.1:${DEBUG_PORT}` },
    }
  : { "tauri:options": { application } }

export const config = {
  host: "127.0.0.1",
  port: DRIVER_PORT,
  specs: ["./specs/**/*.e2e.js"],
  maxInstances: 1,
  capabilities: [
    { maxInstances: 1, "wdio:enforceWebDriverClassic": true, ...capability },
  ],
  reporters: ["spec"],
  framework: "mocha",
  mochaOpts: { ui: "bdd", timeout: 120000 },
  waitforTimeout: 30000,

  onPrepare: seedProject,

  beforeSession: startDrivers,

  afterTest: async (test, context, { passed }) => {
    if (passed) return
    fs.mkdirSync(path.join(here, "output"), { recursive: true })
    await browser.saveScreenshot(path.join(here, "output", `${test.title}.png`))
  },

  afterSession: stopAll,
  onComplete: stopAll,
}
