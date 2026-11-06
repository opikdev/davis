import { invoke } from "@tauri-apps/api/core"

export type EngineInfo = {
  version: string
}

export function getEngineInfo() {
  return invoke<EngineInfo>("engine_info")
}
