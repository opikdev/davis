import { openUrl } from "@tauri-apps/plugin-opener"

export function openExternal(url: string) {
  openUrl(url).catch((error: unknown) => {
    console.error(`Could not open ${url}`, error)
  })
}
