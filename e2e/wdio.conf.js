import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const IDENTIFIER = "dev.opik.davis"
const executable = process.platform === "win32" ? "davis.exe" : "davis"

let tauriDriver
let isClosing = false

function configFolder() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA, IDENTIFIER)
  }
  const base = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config")
  return path.join(base, IDENTIFIER)
}

// Tauri keeps WebView2 data here, and the Edge driver must look in the same place.
function webviewFolder() {
  return path.join(process.env.LOCALAPPDATA, IDENTIFIER, "EBWebView")
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

function closeTauriDriver() {
  isClosing = true
  tauriDriver?.kill()
}

export const config = {
  host: "127.0.0.1",
  port: 4444,
  specs: ["./specs/**/*.e2e.js"],
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      "tauri:options": {
        application: path.resolve(here, "../target/debug", executable),
        ...(process.platform === "win32" && {
          webviewOptions: { userDataFolder: webviewFolder() },
        }),
      },
    },
  ],
  reporters: ["spec"],
  framework: "mocha",
  mochaOpts: { ui: "bdd", timeout: 120000 },
  waitforTimeout: 30000,

  onPrepare: seedProject,

  beforeSession: () => {
    tauriDriver = spawn("tauri-driver", [], {
      stdio: [null, process.stdout, process.stderr],
    })
    tauriDriver.on("error", (error) => {
      console.error("tauri-driver failed to start:", error)
      process.exit(1)
    })
    tauriDriver.on("exit", (code) => {
      if (!isClosing) {
        console.error("tauri-driver exited with code", code)
        process.exit(1)
      }
    })
  },

  afterTest: async (test, context, { passed }) => {
    if (passed) return
    fs.mkdirSync(path.join(here, "output"), { recursive: true })
    await browser.saveScreenshot(path.join(here, "output", `${test.title}.png`))
  },

  afterSession: closeTauriDriver,
  onComplete: closeTauriDriver,
}
