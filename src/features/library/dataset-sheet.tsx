import { useState } from "react"

import { ExternalLink } from "@/components/external-link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  importDataset,
  type Dataset,
  type ImportedDataset,
  type ImportProgress,
} from "@/features/library/api"
import { aboutSize } from "@/features/library/format"
import type { Project } from "@/features/projects"
import { toErrorMessage } from "@/lib/ipc-error"

type DatasetSheetProps = {
  dataset?: Dataset
  isOpen: boolean
  project?: Project
  onImported: (imported: ImportedDataset) => void
  onClose: () => void
  onClosed: () => void
}

function percent({ received, total }: ImportProgress) {
  return total ? Math.round((received / total) * 100) : null
}

// Stays mounted while it closes, so the panel can slide away before the
// dataset it shows is cleared.
export function DatasetSheet({
  dataset,
  isOpen,
  project,
  onImported,
  onClose,
  onClosed,
}: DatasetSheetProps) {
  const [progress, setProgress] = useState<ImportProgress>()
  const [error, setError] = useState<string>()
  const isWorking = progress !== undefined

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(next) => !next && !isWorking && onClose()}
      onOpenChangeComplete={(next) => {
        if (next) return
        setProgress(undefined)
        setError(undefined)
        onClosed()
      }}
    >
      {dataset && (
        <DatasetDetail
          dataset={dataset}
          project={project}
          progress={progress}
          error={error}
          onProgress={setProgress}
          onError={setError}
          onImported={onImported}
        />
      )}
    </Sheet>
  )
}

function DatasetDetail({
  dataset,
  project,
  progress,
  error,
  onProgress,
  onError,
  onImported,
}: {
  dataset: Dataset
  project?: Project
  progress?: ImportProgress
  error?: string
  onProgress: (progress: ImportProgress | undefined) => void
  onError: (error: string | undefined) => void
  onImported: (imported: ImportedDataset) => void
}) {
  const isInProject = Boolean(
    project?.sources.some((source) => source.dataset === dataset.id)
  )
  const isWorking = progress !== undefined

  async function start(target: string | null) {
    onError(undefined)
    onProgress({ label: "Starting", received: 0, total: null })
    try {
      onImported(await importDataset(target, dataset.id, onProgress))
    } catch (failure) {
      onError(toErrorMessage(failure))
      onProgress(undefined)
    }
  }

  const done = progress ? percent(progress) : null

  return (
    <SheetContent className="w-full gap-0 sm:max-w-md">
      <SheetHeader>
        <SheetTitle className="pr-8 text-base">{dataset.title}</SheetTitle>
        <SheetDescription>{dataset.summary}</SheetDescription>
        <div className="flex gap-1.5 pt-1">
          {dataset.isLive && <Badge variant="secondary">Live</Badge>}
          {dataset.isAdvanced && <Badge variant="outline">Advanced</Badge>}
        </div>
      </SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4">
        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-subtle">Publisher</dt>
          <dd>
            <ExternalLink href={dataset.sourceUrl}>
              {dataset.publisher}
            </ExternalLink>
          </dd>
          <dt className="text-subtle">Covers</dt>
          <dd>{dataset.covers}</dd>
          <dt className="text-subtle">Download</dt>
          <dd>{aboutSize(dataset.sizeBytes)}</dd>
          <dt className="text-subtle">License</dt>
          <dd>
            <ExternalLink href={dataset.license.url}>
              {dataset.license.name}
            </ExternalLink>
          </dd>
        </dl>
        <section className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium">Try asking</h3>
          <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
            {dataset.questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </section>
        <section className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium">Credit</h3>
          <p className="text-xs text-muted-foreground">
            {dataset.credit} Davis adds this to Pages you export.
          </p>
        </section>
        <p className="text-xs text-subtle">
          Davis downloads it straight from the publisher. Nothing goes through
          anyone else.
        </p>
      </div>
      <SheetFooter className="border-t">
        {isInProject && !isWorking && (
          <p className="text-xs text-muted-foreground">
            Already in {project?.name}. Adding it again replaces it with the
            latest copy.
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        {progress ? (
          <Progress
            value={done}
            aria-label={progress.label}
            className="flex-col gap-1.5"
          >
            <span className="text-xs text-muted-foreground">
              {progress.label}
              {done !== null && ` · ${done}%`}
            </span>
          </Progress>
        ) : (
          <div className="flex flex-col gap-2">
            <Button onClick={() => void start(null)}>
              Download to a new project
            </Button>
            {project && (
              <Button
                variant="outline"
                onClick={() => void start(project.path)}
              >
                Add to {project.name}
              </Button>
            )}
          </div>
        )}
      </SheetFooter>
    </SheetContent>
  )
}
