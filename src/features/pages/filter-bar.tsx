import {
  Add01Icon,
  ArrowDown01Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  filterBounds,
  filterOptions,
  projectColumns,
  type PageFilter,
  type ProjectColumns,
} from "@/features/pages/api"
import { DAY_LENGTH, shiftDays } from "@/features/pages/format"
import { toErrorMessage } from "@/lib/ipc-error"

const trigger =
  "h-6 max-w-72 justify-start gap-1 px-2 font-normal text-foreground"

function ValuesFilter({
  filter,
  project,
  onChange,
}: {
  filter: PageFilter
  project: string
  onChange: (change: Partial<PageFilter>) => void
}) {
  const [options, setOptions] = useState<string[]>()
  const [error, setError] = useState<string>()
  const { values } = filter

  function load(isOpen: boolean) {
    if (!isOpen || options) return
    filterOptions(project, filter.table, filter.column)
      .then(setOptions)
      .catch((failure: unknown) => setError(toErrorMessage(failure)))
  }

  function toggle(option: string, isChosen: boolean) {
    onChange({
      values: isChosen
        ? [...values, option]
        : values.filter((value) => value !== option),
    })
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
        render={
          <Button
            variant="outline"
            size="sm"
            aria-label={`Filter ${filter.column}`}
            className={trigger}
          />
        }
      >
        <span className="shrink-0 text-muted-foreground">{filter.column}</span>
        <span className="truncate font-medium">{summary}</span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          strokeWidth={1.5}
          className="size-3 text-subtle"
        />
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

function DatesFilter({
  filter,
  project,
  onChange,
}: {
  filter: PageFilter
  project: string
  onChange: (change: Partial<PageFilter>) => void
}) {
  const [bounds, setBounds] = useState<[string, string]>()
  const { from, to } = filter
  const summary =
    from && to
      ? `${from} to ${to}`
      : from
        ? `From ${from}`
        : to
          ? `To ${to}`
          : "All dates"

  function load(isOpen: boolean) {
    if (!isOpen || bounds) return
    filterBounds(project, filter.table, filter.column)
      .then((found) => {
        if (found) {
          setBounds([
            found[0].slice(0, DAY_LENGTH),
            found[1].slice(0, DAY_LENGTH),
          ])
        }
      })
      .catch((failure: unknown) =>
        console.error("Could not read the date range", failure)
      )
  }

  const last = bounds?.[1]
  const presets = last
    ? [
        { label: "Last 7 days", from: shiftDays(last, -6), to: last },
        { label: "Last 30 days", from: shiftDays(last, -29), to: last },
        { label: "Last 90 days", from: shiftDays(last, -89), to: last },
        { label: "Latest year", from: `${last.slice(0, 4)}-01-01`, to: last },
      ]
    : []

  return (
    <Popover onOpenChange={load}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            aria-label={`Filter ${filter.column}`}
            className={trigger}
          />
        }
      >
        <span className="shrink-0 text-muted-foreground">{filter.column}</span>
        <span className="truncate font-medium">{summary}</span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          strokeWidth={1.5}
          className="size-3 text-subtle"
        />
      </PopoverTrigger>
      <PopoverContent
        aria-label={`Filter ${filter.column}`}
        align="start"
        className="w-64 gap-2 p-2.5 text-xs"
      >
        <div className="grid grid-cols-2 gap-1">
          {presets.map((preset) => (
            <Button
              key={preset.label}
              variant="ghost"
              size="sm"
              className="justify-start font-normal"
              onClick={() => onChange({ from: preset.from, to: preset.to })}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${filter.id}-from`}>From</Label>
            <Input
              id={`${filter.id}-from`}
              type="date"
              value={from ?? ""}
              min={bounds?.[0]}
              max={bounds?.[1]}
              onChange={(event) =>
                onChange({ from: event.target.value || null })
              }
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${filter.id}-to`}>To</Label>
            <Input
              id={`${filter.id}-to`}
              type="date"
              value={to ?? ""}
              min={bounds?.[0]}
              max={bounds?.[1]}
              onChange={(event) => onChange({ to: event.target.value || null })}
            />
          </div>
        </div>
        {(from || to) && (
          <Button
            variant="ghost"
            size="sm"
            className="self-start font-normal"
            onClick={() => onChange({ from: null, to: null })}
          >
            Show all dates
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}

function AddFilter({
  project,
  onAdd,
}: {
  project: string
  onAdd: (filter: PageFilter) => void
}) {
  const [choices, setChoices] = useState<ProjectColumns[]>([])
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    projectColumns(project)
      .then(setChoices)
      .catch((failure: unknown) =>
        console.error("Could not list the columns", failure)
      )
  }, [isOpen, project])

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        render={<Button variant="ghost" size="sm" className="font-normal" />}
      >
        <HugeiconsIcon
          icon={Add01Icon}
          strokeWidth={1.5}
          data-icon="inline-start"
        />
        Add filter
      </PopoverTrigger>
      <PopoverContent
        aria-label="Add filter"
        align="start"
        className="w-64 p-1"
      >
        <Command className="bg-transparent p-0">
          <CommandInput placeholder="Find a column" />
          <CommandList className="max-h-64">
            <CommandEmpty>No columns found.</CommandEmpty>
            {choices.map(({ table, columns }) => (
              <CommandGroup key={table} heading={table}>
                {columns.map(({ name, kind }) => (
                  <CommandItem
                    key={name}
                    value={`${table} ${name}`}
                    onSelect={() => {
                      setIsOpen(false)
                      onAdd({
                        id: `filter-${crypto.randomUUID()}`,
                        table,
                        column: name,
                        kind: kind === "date" ? "dates" : "values",
                        values: [],
                        from: null,
                        to: null,
                      })
                    }}
                  >
                    {name}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

type FilterBarProps = {
  project: string
  filters: PageFilter[]
  clicked: PageFilter[]
  reach: Record<string, string[]>
  isEditing: boolean
  onChange: (id: string, change: Partial<PageFilter>) => void
  onAdd: (filter: PageFilter) => void
  onRemove: (id: string) => void
  onClearClicked: (id: string) => void
}

export function FilterBar({
  project,
  filters,
  clicked,
  reach,
  isEditing,
  onChange,
  onAdd,
  onRemove,
  onClearClicked,
}: FilterBarProps) {
  const reached = [...new Set(Object.values(reach).flat())]
  if (filters.length === 0 && clicked.length === 0 && !isEditing) return null

  return (
    <div className="flex shrink-0 flex-col gap-1 px-3 pb-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {filters.map((filter) => (
          <div key={filter.id} className="flex items-center">
            {filter.kind === "dates" ? (
              <DatesFilter
                filter={filter}
                project={project}
                onChange={(change) => onChange(filter.id, change)}
              />
            ) : (
              <ValuesFilter
                filter={filter}
                project={project}
                onChange={(change) => onChange(filter.id, change)}
              />
            )}
            {isEditing && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove filter ${filter.column}`}
                className="size-5"
                onClick={() => onRemove(filter.id)}
              >
                <HugeiconsIcon icon={Cancel01Icon} strokeWidth={1.5} />
              </Button>
            )}
          </div>
        ))}
        {clicked.map((filter) => (
          <Button
            key={filter.id}
            variant="secondary"
            size="sm"
            aria-label={`Clear ${filter.column} ${filter.values[0]}`}
            className="h-6 gap-1 px-2 font-normal"
            onClick={() => onClearClicked(filter.id)}
          >
            {filter.column}: {filter.values[0]}
            <HugeiconsIcon
              icon={Cancel01Icon}
              strokeWidth={1.5}
              className="size-3"
            />
          </Button>
        ))}
        {isEditing && <AddFilter project={project} onAdd={onAdd} />}
      </div>
      {reached.length > 0 && (
        <p className="truncate text-xs text-subtle" title={reached.join(", ")}>
          Filtering {reached.join(", ")}
        </p>
      )}
    </div>
  )
}
