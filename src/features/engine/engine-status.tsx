import { Button } from "@/components/ui/button"
import { useEngineInfo } from "@/features/engine/use-engine-info"

export function EngineStatus() {
  const { state, retry } = useEngineInfo()

  return (
    <div role="status" className="flex flex-wrap items-center gap-2 text-xs">
      {state.status === "loading" && (
        <span className="text-muted-foreground">Starting query engine…</span>
      )}
      {state.status === "ready" && (
        <span className="font-mono text-muted-foreground tabular-nums">
          DuckDB {state.info.version} ready
        </span>
      )}
      {state.status === "error" && (
        <>
          <span className="text-destructive">
            Query engine failed to start: {state.message}
          </span>
          <Button variant="outline" size="sm" onClick={retry}>
            Restart query engine
          </Button>
        </>
      )}
    </div>
  )
}
