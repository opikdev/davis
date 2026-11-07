import { AiChat02Icon, Cancel01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  buildBlockQuery,
  projectColumns,
  type Aggregate,
  type Block,
  type BlockView,
  type Grain,
  type ProjectColumns,
  type QuerySpec,
} from "@/features/pages/api"
import { FORMATS } from "@/features/pages/format"
import { toErrorMessage } from "@/lib/ipc-error"

const NONE = "none"

const VIEWS: { value: BlockView; label: string }[] = [
  { value: "bar", label: "Bar" },
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "stacked", label: "Stacked" },
  { value: "scatter", label: "Scatter" },
  { value: "number", label: "Number" },
  { value: "table", label: "Table" },
]

const AGGREGATES: { value: Aggregate; label: string }[] = [
  { value: "sum", label: "Total of" },
  { value: "average", label: "Average of" },
  { value: "maximum", label: "Highest" },
  { value: "minimum", label: "Lowest" },
  { value: "distinct", label: "Unique" },
  { value: "count", label: "Number of rows" },
]

const GRAINS: { value: Grain; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
]

const WIDTHS = [
  { value: "1", label: "Normal" },
  { value: "2", label: "Wide" },
  { value: "3", label: "Widest" },
]

type Option = { value: string; label: string }

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Option[]
  onChange: (value: string) => void
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Select
        value={value}
        items={options}
        onValueChange={(next) => {
          if (next !== null) onChange(next)
        }}
      >
        <SelectTrigger aria-label={label} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

export function defaultSpec(tables: ProjectColumns[]): QuerySpec | undefined {
  const table = tables[0]
  if (!table) return undefined
  const measure = table.columns.find(
    ({ kind, name }) => kind === "number" && !/id$/i.test(name)
  )
  const by = table.columns.find(({ kind }) => kind === "text")
  return {
    table: table.table,
    aggregate: measure ? "sum" : "count",
    measure: measure?.name ?? null,
    by: by?.name ?? null,
    grain: null,
    series: null,
    trendBy: null,
    trendGrain: null,
  }
}

type BlockSettingsProps = {
  project: string
  block: Block
  onChange: (change: Partial<Block>, shouldRun?: boolean) => void
  onClose: () => void
  onAskAi: () => void
}

export function BlockSettings({
  project,
  block,
  onChange,
  onClose,
  onAskAi,
}: BlockSettingsProps) {
  const [tables, setTables] = useState<ProjectColumns[]>([])
  const [error, setError] = useState<string>()
  const [sql, setSql] = useState(block.sql ?? "")
  const [isRebuilding, setIsRebuilding] = useState(false)

  useEffect(() => {
    projectColumns(project)
      .then(setTables)
      .catch((failure: unknown) => setError(toErrorMessage(failure)))
  }, [project])

  const spec = block.spec ?? (isRebuilding ? defaultSpec(tables) : undefined)
  const columns =
    tables.find(({ table }) => table === spec?.table)?.columns ?? []
  const numbers = columns.filter(({ kind }) => kind === "number")
  const byColumn = columns.find(({ name }) => name === spec?.by)
  const dates = columns.filter(({ kind }) => kind === "date")
  const isNumber = block.view === "number"
  const asOptions = (items: { name: string }[]) =>
    items.map(({ name }) => ({ value: name, label: name }))
  const noneOption = (label: string) => ({ value: NONE, label })

  async function rebuild(
    change: Partial<QuerySpec>,
    extra: Partial<Block> = {}
  ) {
    if (!spec) return
    const next = { ...spec, ...change }
    try {
      const built = await buildBlockQuery(project, next)
      setSql(built.sql)
      setError(undefined)
      onChange(
        {
          spec: next,
          sql: built.sql,
          trendSql: built.trendSql,
          xColumn: built.xColumn,
          yColumn: built.yColumn,
          seriesColumn: built.seriesColumn,
          ...extra,
        },
        true
      )
    } catch (failure) {
      setError(toErrorMessage(failure))
    }
  }

  return (
    <aside
      aria-label="Block settings"
      className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border bg-background"
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b pr-1.5 pl-3">
        <h2 className="text-foreground">
          {block.kind === "text" ? "Text" : "Block settings"}
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close settings"
          onClick={onClose}
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={1.5} />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {error && (
          <p role="alert" className="text-xs text-destructive select-text">
            {error}
          </p>
        )}
        {block.kind === "figure" && (
          <>
            <Field>
              <FieldLabel htmlFor="block-title">Title</FieldLabel>
              <Input
                key={block.id}
                id="block-title"
                defaultValue={block.title}
                onBlur={(event) => {
                  if (event.target.value !== block.title) {
                    onChange({ title: event.target.value })
                  }
                }}
              />
            </Field>
            <Field>
              <FieldLabel>Show as</FieldLabel>
              <ToggleGroup
                aria-label="Show as"
                value={block.view ? [block.view] : []}
                onValueChange={(next: string[]) => {
                  const view = next[0] as BlockView | undefined
                  if (!view) return
                  const followsTime = view === "line" || view === "area"
                  onChange(
                    block.spec && followsTime && !block.sort
                      ? { view, sort: "label" }
                      : { view }
                  )
                }}
                className="flex-wrap justify-start"
              >
                {VIEWS.map(({ value, label }) => (
                  <ToggleGroupItem
                    key={value}
                    value={value}
                    size="sm"
                    variant="outline"
                  >
                    {label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>
            {!spec && (
              <div className="flex flex-col items-start gap-1.5">
                <p className="text-xs text-muted-foreground">
                  This block runs its own SQL. Replace it with simple choices if
                  you want to change it here.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsRebuilding(true)}
                >
                  Replace with choices
                </Button>
              </div>
            )}
            {spec && (
              <>
                <Choice
                  label="File"
                  value={spec.table}
                  options={tables.map(({ table }) => ({
                    value: table,
                    label: table,
                  }))}
                  onChange={(table) =>
                    void rebuild({
                      table,
                      measure: null,
                      by: null,
                      grain: null,
                      series: null,
                      trendBy: null,
                      trendGrain: null,
                      aggregate: "count",
                    })
                  }
                />
                <Choice
                  label="Measure"
                  value={spec.aggregate}
                  options={AGGREGATES}
                  onChange={(aggregate) =>
                    void rebuild({
                      aggregate: aggregate as Aggregate,
                      measure:
                        aggregate === "count"
                          ? null
                          : (spec.measure ?? numbers[0]?.name ?? null),
                    })
                  }
                />
                {spec.aggregate !== "count" && (
                  <Choice
                    label="Of column"
                    value={spec.measure ?? NONE}
                    options={[
                      noneOption("Choose a column"),
                      ...asOptions(
                        spec.aggregate === "distinct" ? columns : numbers
                      ),
                    ]}
                    onChange={(measure) =>
                      void rebuild({
                        measure: measure === NONE ? null : measure,
                      })
                    }
                  />
                )}
                {isNumber ? (
                  <Choice
                    label="Compare over"
                    value={spec.trendBy ?? NONE}
                    options={[noneOption("No comparison"), ...asOptions(dates)]}
                    onChange={(trendBy) =>
                      void rebuild({
                        trendBy: trendBy === NONE ? null : trendBy,
                        trendGrain:
                          trendBy === NONE
                            ? null
                            : (spec.trendGrain ?? "month"),
                      })
                    }
                  />
                ) : (
                  <Choice
                    label="Broken down by"
                    value={spec.by ?? NONE}
                    options={[noneOption("Nothing"), ...asOptions(columns)]}
                    onChange={(by) => {
                      const chosen = columns.find(({ name }) => name === by)
                      void rebuild({
                        by: by === NONE ? null : by,
                        grain: chosen?.kind === "date" ? "month" : null,
                      })
                    }}
                  />
                )}
                {!isNumber && byColumn?.kind === "date" && (
                  <Choice
                    label="Group by"
                    value={spec.grain ?? "month"}
                    options={GRAINS}
                    onChange={(grain) =>
                      void rebuild({ grain: grain as Grain })
                    }
                  />
                )}
                {isNumber && spec.trendBy && (
                  <Choice
                    label="Compare each"
                    value={spec.trendGrain ?? "month"}
                    options={GRAINS}
                    onChange={(trendGrain) =>
                      void rebuild({ trendGrain: trendGrain as Grain })
                    }
                  />
                )}
                {block.view === "stacked" && (
                  <Choice
                    label="Split by"
                    value={spec.series ?? NONE}
                    options={[noneOption("Nothing"), ...asOptions(columns)]}
                    onChange={(series) =>
                      void rebuild({ series: series === NONE ? null : series })
                    }
                  />
                )}
              </>
            )}
            <Choice
              label="Format"
              value={block.format ?? "number"}
              options={FORMATS}
              onChange={(format) => onChange({ format })}
            />
            {!isNumber && (
              <>
                <Choice
                  label="Sort"
                  value={block.sort ?? NONE}
                  options={[
                    noneOption("As it comes"),
                    { value: "value", label: "Largest first" },
                    { value: "label", label: "A to Z" },
                  ]}
                  onChange={(sort) =>
                    onChange({
                      sort: sort === NONE ? null : (sort as Block["sort"]),
                    })
                  }
                />
                <Field>
                  <FieldLabel htmlFor="block-limit">Show top</FieldLabel>
                  <Input
                    id="block-limit"
                    type="number"
                    min={1}
                    placeholder="All"
                    defaultValue={block.limit ?? ""}
                    onBlur={(event) => {
                      const limit = Number(event.target.value) || null
                      if (limit !== block.limit) onChange({ limit })
                    }}
                  />
                </Field>
                <Field orientation="horizontal">
                  <FieldLabel htmlFor="block-labels">Show values</FieldLabel>
                  <Switch
                    id="block-labels"
                    checked={block.showLabels}
                    onCheckedChange={(showLabels) => onChange({ showLabels })}
                  />
                </Field>
              </>
            )}
            <Choice
              label="Width in its row"
              value={String(block.weight)}
              options={WIDTHS}
              onChange={(weight) => onChange({ weight: Number(weight) })}
            />
            <Collapsible>
              <CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground">
                Edit the SQL
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-1.5 flex flex-col gap-1.5">
                <Textarea
                  key={block.sql}
                  aria-label="SQL"
                  value={sql}
                  onChange={(event) => setSql(event.target.value)}
                  className="min-h-28 font-mono text-[0.6875rem]/relaxed"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="self-start"
                  disabled={sql === block.sql}
                  onClick={() => onChange({ sql, spec: null }, true)}
                >
                  Run this SQL
                </Button>
              </CollapsibleContent>
            </Collapsible>
          </>
        )}
      </div>
      <div className="shrink-0 border-t p-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={onAskAi}
        >
          <HugeiconsIcon
            icon={AiChat02Icon}
            strokeWidth={1.5}
            data-icon="inline-start"
          />
          Ask AI to change this
        </Button>
      </div>
    </aside>
  )
}
