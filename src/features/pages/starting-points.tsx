import {
  Analytics01Icon,
  ChartBarLineIcon,
  ChartLineData01Icon,
  Note01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"

import { Button } from "@/components/ui/button"
import type { DraftKind } from "@/features/pages/api"

const STARTING_POINTS: {
  kind: DraftKind
  icon: IconSvgElement
  title: string
  detail: string
}[] = [
  {
    kind: "overview",
    icon: Analytics01Icon,
    title: "Overview",
    detail: "Key numbers, a trend and a breakdown",
  },
  {
    kind: "trends",
    icon: ChartLineData01Icon,
    title: "Trends",
    detail: "How things change over time",
  },
  {
    kind: "compare",
    icon: ChartBarLineIcon,
    title: "Compare groups",
    detail: "How groups stack up against each other",
  },
  {
    kind: "report",
    icon: Note01Icon,
    title: "Report",
    detail: "Your writing with the evidence beside it",
  },
]

type StartingPointsProps = {
  hasData: boolean
  onDraft: (kind: DraftKind) => void
  onStartBlank: () => void
}

export function StartingPoints({
  hasData,
  onDraft,
  onStartBlank,
}: StartingPointsProps) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-3 px-3 pb-10">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-medium">Start this Page</h2>
        <p className="text-muted-foreground">
          {hasData
            ? "Davis drafts it from your data, and you can change anything."
            : "Add a data file to this project first."}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {STARTING_POINTS.map(({ kind, icon, title, detail }) => (
          <Button
            key={kind}
            variant="outline"
            disabled={!hasData}
            onClick={() => onDraft(kind)}
            className="h-auto flex-col items-start gap-1 p-2.5 text-left font-normal whitespace-normal"
          >
            <span className="flex items-center gap-1.5 font-medium">
              <HugeiconsIcon icon={icon} strokeWidth={1.5} />
              {title}
            </span>
            <span className="text-xs text-muted-foreground">{detail}</span>
          </Button>
        ))}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="self-start font-normal"
        onClick={onStartBlank}
      >
        Start with a blank Page
      </Button>
    </div>
  )
}
