import {
  Cancel01Icon,
  DragDropVerticalIcon,
  Table01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { DraggableAttributes } from "@dnd-kit/core"
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import {
  AnswerText,
  ResultTable,
  type QueryResult,
  type StoredQuery,
} from "@/features/chat"
import type { Block, BlockResult, Grain } from "@/features/pages/api"
import {
  arrangedRows,
  formatNumber,
  formatValue,
  latestChange,
} from "@/features/pages/format"
import { PageChart } from "@/features/pages/page-chart"
import { cn } from "@/lib/utils"

const ALL_ROWS = 1000
const EXPORTED_ROWS = 20
const SPARK_WIDTH = 72
const SPARK_HEIGHT = 24

function Sparkline({ trend }: { trend: QueryResult }) {
  const values = trend.rows.map((row) => Number(row[1]))
  if (values.length < 2) return null
  const low = Math.min(...values)
  const range = Math.max(...values) - low || 1
  const step = SPARK_WIDTH / (values.length - 1)
  const points = values
    .map((value, index) => {
      const y = SPARK_HEIGHT - 2 - ((value - low) / range) * (SPARK_HEIGHT - 4)
      return `${index * step},${y}`
    })
    .join(" ")
  return (
    <svg
      aria-hidden="true"
      width={SPARK_WIDTH}
      height={SPARK_HEIGHT}
      className="shrink-0 overflow-visible"
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--chart-1)"
        strokeWidth={1.5}
      />
    </svg>
  )
}

function NumberBody({
  block,
  result,
  trend,
}: {
  block: Block
  result: QueryResult
  trend: QueryResult | null
}) {
  const column = result.columns.findIndex(({ name }) => name === block.yColumn)
  const value = result.rows[0]?.[Math.max(column, 0)] ?? null
  const change = latestChange(trend)

  return (
    <div className="@container/number flex min-w-0 flex-col gap-0.5">
      <p className="truncate text-xl font-medium tabular-nums select-text">
        {formatValue(value, block.format)}
      </p>
      <div className="flex min-h-6 items-center justify-between gap-2">
        {change && (
          <p className="text-xs text-muted-foreground tabular-nums">
            {change.percent === null ? (
              `${change.period} ${formatNumber(change.value, block.format)}`
            ) : (
              <>
                <span className="font-medium text-foreground">
                  {change.percent >= 0 ? "Up" : "Down"}{" "}
                  {formatNumber(Math.abs(change.percent), "percent")}
                </span>{" "}
                in {change.period}
              </>
            )}
          </p>
        )}
        {trend && (
          <div className="ml-auto @max-[11rem]/number:hidden">
            <Sparkline trend={trend} />
          </div>
        )}
      </div>
    </div>
  )
}

function TableBody({
  block,
  result,
  isExporting,
}: {
  block: Block
  result: QueryResult
  isExporting?: boolean
}) {
  const rows = arrangedRows(block, result)
  if (isExporting) {
    return <ResultTable result={{ ...result, rows }} rowLimit={EXPORTED_ROWS} />
  }
  return (
    <div
      role="region"
      aria-label={block.title || "Table"}
      tabIndex={0}
      className="max-h-80 min-h-0 flex-1 overflow-auto"
    >
      <ResultTable result={{ ...result, rows }} rowLimit={ALL_ROWS} />
    </div>
  )
}

function FigureBody({
  block,
  outcome,
  isExporting,
  onSelectValue,
}: {
  block: Block
  outcome?: BlockResult
  isExporting?: boolean
  onSelectValue?: (column: string, value: string, grain?: Grain) => void
}) {
  if (outcome?.error) {
    return (
      <p className="text-xs text-destructive select-text">{outcome.error}</p>
    )
  }
  if (!outcome?.result) return <Skeleton className="min-h-10 flex-1" />
  const { result, trend } = outcome
  if (result.rows.length === 0) {
    return <p className="text-xs text-subtle">Nothing matches this filter.</p>
  }
  if (block.view === "number") {
    return <NumberBody block={block} result={result} trend={trend} />
  }
  if (block.view === "table") {
    return <TableBody block={block} result={result} isExporting={isExporting} />
  }
  const { xColumn } = block
  return (
    <div className="h-56 min-h-0">
      <PageChart
        block={block}
        result={result}
        onSelect={
          onSelectValue && xColumn
            ? (label) =>
                onSelectValue(xColumn, label, block.spec?.grain ?? undefined)
            : undefined
        }
      />
    </div>
  )
}

function TextBody({
  block,
  outcome,
  isEditing,
  onChange,
}: {
  block: Block
  outcome?: BlockResult
  isEditing: boolean
  onChange: (text: string) => void
}) {
  if (isEditing) {
    return (
      <Textarea
        aria-label="Text"
        placeholder="Write what this Page shows"
        defaultValue={block.text ?? ""}
        onBlur={(event) => {
          if (event.target.value !== (block.text ?? "")) {
            onChange(event.target.value)
          }
        }}
        className="min-h-16 resize-none border-0 bg-transparent p-0 text-sm/relaxed shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
    )
  }
  const queries: Record<string, StoredQuery> = Object.fromEntries(
    Object.entries(outcome?.sources ?? {}).map(([id, result]) => [
      id,
      { sql: block.sources[id] ?? "", result },
    ])
  )
  return block.text ? (
    <div className="text-sm">
      <AnswerText text={block.text} queries={queries} />
    </div>
  ) : null
}

function DataDialog({
  block,
  outcome,
  onClose,
}: {
  block: Block
  outcome?: BlockResult
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-3 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{block.title || "Block data"}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto">
          {outcome?.result && (
            <ResultTable result={outcome.result} rowLimit={ALL_ROWS} />
          )}
        </div>
        {block.sql && (
          <pre className="max-h-32 overflow-auto rounded-md border bg-sidebar px-2 py-1.5 font-mono text-[0.6875rem]/relaxed break-words whitespace-pre-wrap text-muted-foreground select-text">
            {block.sql}
          </pre>
        )}
      </DialogContent>
    </Dialog>
  )
}

type BlockViewProps = {
  block: Block
  outcome?: BlockResult
  isEditing: boolean
  isSelected: boolean
  isExporting?: boolean
  dragAttributes?: DraggableAttributes
  dragListeners?: SyntheticListenerMap
  onSelect: () => void
  onRemove: () => void
  onTextChange: (text: string) => void
  onSelectValue?: (column: string, value: string, grain?: Grain) => void
}

export function BlockView({
  block,
  outcome,
  isEditing,
  isSelected,
  isExporting,
  dragAttributes,
  dragListeners,
  onSelect,
  onRemove,
  onTextChange,
  onSelectValue,
}: BlockViewProps) {
  const [isViewingData, setIsViewingData] = useState(false)
  const label = block.title || (block.kind === "text" ? "Text" : "Block")
  const showsFrame = block.kind === "figure" || isEditing
  const showsTitle = block.kind === "figure" && block.title

  return (
    <div
      className={cn(
        "group/block relative flex h-full min-w-0 flex-col gap-1.5 rounded-xl",
        showsFrame && "border bg-background p-2.5",
        isSelected && "border-primary"
      )}
      onClick={isEditing ? onSelect : undefined}
    >
      {showsTitle && <h2 className="truncate pr-1 font-medium">{label}</h2>}
      <div
        hidden={isExporting}
        className={cn(
          "absolute top-1.5 right-1.5 z-10 flex rounded-md bg-background opacity-0 transition-opacity group-focus-within/block:opacity-100 group-hover/block:opacity-100",
          isSelected && "opacity-100"
        )}
      >
        {isEditing && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Move ${label}`}
            className="cursor-grab touch-none active:cursor-grabbing"
            {...dragAttributes}
            {...dragListeners}
          >
            <HugeiconsIcon icon={DragDropVerticalIcon} strokeWidth={1.5} />
          </Button>
        )}
        {block.kind === "figure" && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`View data for ${label}`}
            onClick={(event) => {
              event.stopPropagation()
              setIsViewingData(true)
            }}
          >
            <HugeiconsIcon icon={Table01Icon} strokeWidth={1.5} />
          </Button>
        )}
        {isEditing && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${label}`}
            onClick={(event) => {
              event.stopPropagation()
              onRemove()
            }}
          >
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={1.5} />
          </Button>
        )}
      </div>
      {block.kind === "figure" ? (
        <FigureBody
          block={block}
          outcome={outcome}
          isExporting={isExporting}
          onSelectValue={isEditing ? undefined : onSelectValue}
        />
      ) : (
        <TextBody
          block={block}
          outcome={outcome}
          isEditing={isEditing}
          onChange={onTextChange}
        />
      )}
      {isViewingData && (
        <DataDialog
          block={block}
          outcome={outcome}
          onClose={() => setIsViewingData(false)}
        />
      )}
    </div>
  )
}
