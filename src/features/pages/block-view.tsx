import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import {
  AnswerChart,
  formatValue,
  ResultTable,
  type QueryResult,
} from "@/features/chat"
import {
  filterOptions,
  type Block,
  type BlockResult,
} from "@/features/pages/api"
import { toErrorMessage } from "@/lib/ipc-error"

const ALL_ROWS = 1000

function FigureBody({ block, result }: { block: Block; result: QueryResult }) {
  if (result.rows.length === 0) {
    return <p className="text-xs text-subtle">Nothing matches this filter.</p>
  }
  if (block.view === "number") {
    const column = result.columns.findIndex(
      ({ name }) => name === block.yColumn
    )
    const value = result.rows[0]?.[Math.max(column, 0)]
    return (
      <p className="text-2xl font-medium tabular-nums select-text">
        {value ? formatValue(value) : "No value"}
      </p>
    )
  }
  if (block.view === "table") {
    return (
      <div className="min-h-0 flex-1 overflow-auto">
        <ResultTable result={result} rowLimit={ALL_ROWS} />
      </div>
    )
  }
  return (
    <div className="min-h-0 flex-1">
      <AnswerChart
        fill
        figure={{
          query: block.id,
          title: block.title,
          view: block.view ?? "bar",
          x: block.xColumn,
          y: block.yColumn,
        }}
        result={result}
      />
    </div>
  )
}

function FigureBlock({
  block,
  outcome,
}: {
  block: Block
  outcome?: BlockResult
}) {
  if (outcome?.error) {
    return (
      <p className="text-xs text-destructive select-text">{outcome.error}</p>
    )
  }
  if (!outcome?.result) return <Skeleton className="min-h-0 flex-1" />
  return <FigureBody block={block} result={outcome.result} />
}

function TextBlock({
  block,
  isLocked,
  onChange,
}: {
  block: Block
  isLocked: boolean
  onChange: (text: string) => void
}) {
  return (
    <Textarea
      aria-label="Note"
      placeholder="Write a note"
      defaultValue={block.text ?? ""}
      readOnly={isLocked}
      onBlur={(event) => {
        if (event.target.value !== (block.text ?? "")) {
          onChange(event.target.value)
        }
      }}
      className="min-h-0 flex-1 resize-none border-0 bg-transparent p-0 leading-relaxed shadow-none focus-visible:ring-0 dark:bg-transparent"
    />
  )
}

function FilterBlock({
  block,
  project,
  isLocked,
  onChange,
}: {
  block: Block
  project: string
  isLocked: boolean
  onChange: (values: string[]) => void
}) {
  const [options, setOptions] = useState<string[]>()
  const [error, setError] = useState<string>()
  const { values } = block

  function load(isOpen: boolean) {
    if (!isOpen || options || !block.table || !block.column) return
    filterOptions(project, block.table, block.column)
      .then(setOptions)
      .catch((failure: unknown) => setError(toErrorMessage(failure)))
  }

  function toggle(option: string, isChosen: boolean) {
    onChange(
      isChosen
        ? [...values, option]
        : values.filter((value) => value !== option)
    )
  }

  const summary =
    values.length === 0
      ? "All"
      : values.length === 1
        ? values[0]
        : `${values.length} chosen`

  return (
    <DropdownMenu onOpenChange={load}>
      <DropdownMenuTrigger
        disabled={isLocked}
        render={
          <Button
            variant="outline"
            size="sm"
            aria-label={`Filter ${block.column ?? ""}`}
            className="max-w-full justify-start truncate font-normal"
          />
        }
      >
        <span className="truncate">{summary}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 min-w-44">
        {error && <p className="p-2 text-xs text-destructive">{error}</p>}
        {!error && !options && (
          <p className="p-2 text-xs text-subtle">Loading</p>
        )}
        {options?.map((option) => (
          <DropdownMenuCheckboxItem
            key={option}
            checked={values.includes(option)}
            onCheckedChange={(isChosen) => toggle(option, isChosen)}
          >
            <span className="truncate">{option}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type BlockViewProps = {
  block: Block
  outcome?: BlockResult
  reach?: string[]
  project: string
  isLocked: boolean
  onRemove: () => void
  onTextChange: (text: string) => void
  onFilterChange: (values: string[]) => void
}

export function BlockView({
  block,
  outcome,
  reach,
  project,
  isLocked,
  onRemove,
  onTextChange,
  onFilterChange,
}: BlockViewProps) {
  const label = block.title || (block.kind === "text" ? "Note" : block.column)

  return (
    <div className="group/block flex h-full flex-col gap-1.5 overflow-hidden rounded-xl border bg-background p-2.5">
      <div className="block-handle flex h-5 shrink-0 cursor-grab items-center justify-between gap-2 active:cursor-grabbing">
        <h2 className="truncate text-xs text-muted-foreground">{label}</h2>
        {!isLocked && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${label}`}
            onClick={onRemove}
            className="block-action size-5 opacity-0 transition-opacity group-focus-within/block:opacity-100 group-hover/block:opacity-100"
          >
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={1.5} />
          </Button>
        )}
      </div>
      {block.kind === "figure" && (
        <FigureBlock block={block} outcome={outcome} />
      )}
      {block.kind === "text" && (
        <TextBlock block={block} isLocked={isLocked} onChange={onTextChange} />
      )}
      {block.kind === "filter" && (
        <FilterBlock
          block={block}
          project={project}
          isLocked={isLocked}
          onChange={onFilterChange}
        />
      )}
      {reach && (
        <p className="truncate text-xs text-subtle" title={reach.join(", ")}>
          Filtering {reach.join(", ")}
        </p>
      )}
    </div>
  )
}
