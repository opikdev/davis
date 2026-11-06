import { DavisMark } from "@/components/davis-mark"

export function Workspace() {
  return (
    <div className="flex h-svh animate-fade flex-col">
      <header data-tauri-drag-region="deep" className="h-12 shrink-0" />
      <main
        aria-label="Davis"
        className="flex flex-1 items-center justify-center pb-12"
      >
        <DavisMark className="size-8" />
      </main>
    </div>
  )
}
