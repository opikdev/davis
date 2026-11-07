import { Link01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"
import type { OpenedTable } from "@/features/data"
import {
  combineProjectFiles,
  projectLinks,
  type FileLink,
} from "@/features/projects/api"
import { toErrorMessage } from "@/lib/ipc-error"

// A near match must never read as a perfect one.
function matchText(percent: number) {
  return percent >= 100 ? "100%" : `${Math.min(percent, 99.9).toFixed(1)}%`
}

type LinkedFilesProps = {
  project: string
  fileName: string
  fileCount: number
  onCombined: (table: OpenedTable) => void
}

export function LinkedFiles({
  project,
  fileName,
  fileCount,
  onCombined,
}: LinkedFilesProps) {
  const [links, setLinks] = useState<FileLink[]>([])
  const [isCombining, setIsCombining] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let isCurrent = true
    projectLinks(project)
      .then((found) => {
        if (isCurrent) setLinks(found)
      })
      .catch((failure: unknown) =>
        console.error("Could not look for linked files", failure)
      )
    return () => {
      isCurrent = false
    }
  }, [project, fileCount])

  const mine = links.filter(({ fromFile }) => fromFile === fileName)
  if (mine.length === 0) return null

  async function combine(link: FileLink) {
    setIsCombining(true)
    setError(undefined)
    try {
      onCombined(await combineProjectFiles(project, link))
    } catch (failure) {
      setError(toErrorMessage(failure))
    } finally {
      setIsCombining(false)
    }
  }

  return (
    <Popover>
      <PopoverTrigger className="flex shrink-0 items-center gap-1 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40">
        <HugeiconsIcon icon={Link01Icon} strokeWidth={1.5} className="size-3" />
        {mine.length === 1 ? mine[0].toFile : `${mine.length} linked files`}
      </PopoverTrigger>
      <PopoverContent
        aria-label="Linked files"
        side="top"
        align="start"
        className="w-72 gap-3 p-3 text-xs"
      >
        {mine.map((link) => (
          <div
            key={`${link.toFile}-${link.fromColumn}`}
            className="flex flex-col gap-2"
          >
            <p className="leading-relaxed text-muted-foreground">
              <span className="text-foreground">{link.fromColumn}</span> matches{" "}
              <span className="text-foreground">{link.toColumn}</span> in{" "}
              {link.toFile} for {matchText(link.matchPercent)} of rows. Adding
              its columns makes a new file and keeps every row.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              disabled={isCombining}
              onClick={() => void combine(link)}
            >
              {isCombining && <Spinner data-icon="inline-start" />}
              Add columns from {link.toFile}
            </Button>
          </div>
        ))}
        {error && <p className="text-destructive select-text">{error}</p>}
      </PopoverContent>
    </Popover>
  )
}
