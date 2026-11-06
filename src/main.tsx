import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import { App } from "@/app/app"
import { playPressSounds } from "@/lib/sound/player"
import { markOperatingSystem } from "@/lib/operating-system"
import { hidePageContextMenu } from "@/lib/page-context-menu"
import { followSystemTheme } from "@/lib/system-theme"

followSystemTheme()
markOperatingSystem()
playPressSounds()
if (import.meta.env.PROD) hidePageContextMenu()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
