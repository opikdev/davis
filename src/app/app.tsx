import { EngineStatus } from "@/features/engine/engine-status"

export function App() {
  return (
    <div className="flex h-svh flex-col">
      <main className="flex flex-1 flex-col gap-1 p-4">
        <h1 className="text-sm font-medium">Davis</h1>
        <p className="text-xs text-muted-foreground">Local data workspace</p>
      </main>
      <footer className="flex min-h-8 items-center border-t px-4 py-1">
        <EngineStatus />
      </footer>
    </div>
  )
}
