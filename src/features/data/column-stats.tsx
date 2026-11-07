import { useState } from "react"

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import {
  columnValues,
  type Column,
  type ColumnProfile,
  type TableSource,
  type ValueCount,
} from "@/features/data/api"

const OPEN_DELAY_MS = 350

function formatted(value: string | null) {
  if (value === null) return "none"
  const number = Number(value)
  return value.trim() === "" || Number.isNaN(number)
    ? value
    : number.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-subtle">{label}</dt>
      <dd className="truncate text-foreground tabular-nums">{value}</dd>
    </div>
  )
}

function Histogram({ values }: { values: ValueCount[] }) {
  const largest = Math.max(...values.map(({ count }) => count))
  return (
    <div aria-hidden="true" className="flex h-10 items-end gap-px">
      {values.map(({ label, count }) => (
        <div
          key={label}
          title={`${label}: ${count.toLocaleString()}`}
          className="min-h-px flex-1 rounded-t-[1px] bg-primary"
          style={{ height: `${(count / largest) * 100}%` }}
        />
      ))}
    </div>
  )
}

function TopValues({ values }: { values: ValueCount[] }) {
  const largest = Math.max(...values.map(({ count }) => count))
  return (
    <ul className="flex flex-col gap-1">
      {values.map(({ label, count }) => (
        <li key={label} className="flex flex-col gap-0.5">
          <div className="flex justify-between gap-3">
            <span className="truncate text-foreground">{label}</span>
            <span className="text-subtle tabular-nums">
              {count.toLocaleString()}
            </span>
          </div>
          <div
            aria-hidden="true"
            className="h-0.5 rounded-full bg-primary"
            style={{ width: `${(count / largest) * 100}%` }}
          />
        </li>
      ))}
    </ul>
  )
}

type ColumnStatsProps = {
  column: Column
  source: TableSource
  profile?: ColumnProfile
  children: React.ReactNode
}

export function ColumnStats({
  column,
  source,
  profile,
  children,
}: ColumnStatsProps) {
  const [values, setValues] = useState<ValueCount[]>()

  function load(isOpen: boolean) {
    if (!isOpen || values) return
    columnValues(source, column.name, column.kind)
      .then(setValues)
      .catch((error: unknown) =>
        console.error("Could not read the column's values", error)
      )
  }

  return (
    <HoverCard onOpenChange={load}>
      <HoverCardTrigger
        delay={OPEN_DELAY_MS}
        render={<span className="flex min-w-0 items-center gap-1.5" />}
      >
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        side="bottom"
        align="start"
        className="flex w-56 flex-col gap-2 p-2.5 text-xs"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate font-medium text-foreground">
            {column.name}
          </span>
          <span className="shrink-0 text-subtle">{column.dataType}</span>
        </div>
        {profile && (
          <dl className="flex flex-col gap-0.5">
            <Fact
              label="Missing"
              value={`${profile.missingPercent.toFixed(1)}%`}
            />
            <Fact
              label="Unique values"
              value={`about ${profile.uniqueValues.toLocaleString()}`}
            />
            <Fact
              label="Range"
              value={`${formatted(profile.min)} to ${formatted(profile.max)}`}
            />
            {profile.mean !== null && (
              <Fact label="Average" value={formatted(profile.mean)} />
            )}
          </dl>
        )}
        {values &&
          values.length > 0 &&
          (column.kind === "number" ? (
            <Histogram values={values} />
          ) : (
            <TopValues values={values} />
          ))}
      </HoverCardContent>
    </HoverCard>
  )
}
