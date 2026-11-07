import { DavisMark } from "@/components/davis-mark"
import { SoundToggle } from "@/components/sound-toggle"

export function TitleBar({ label }: { label?: string }) {
  return (
    <header
      data-tauri-drag-region="deep"
      className="flex h-10 shrink-0 items-center justify-between border-b px-3 macos:pl-20"
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <DavisMark className="size-3.5" />
        Davis
      </div>
      <div className="flex items-center gap-2">
        <SoundToggle />
        {label && (
          <span className="animate-fade text-xs text-muted-foreground tabular-nums">
            {label}
          </span>
        )}
      </div>
    </header>
  )
}
