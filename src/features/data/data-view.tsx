import { useCallback, useState } from "react"

import { Badge } from "@/components/ui/badge"
import type { ColumnProfile, OpenedTable } from "@/features/data/api"
import { gapsNote } from "@/features/data/data-brief"
import { DataTable } from "@/features/data/data-table"

function repairNote({ source, skippedRows }: OpenedTable) {
  if (source.repair === "skip-bad-rows") {
    const rows =
      skippedRows === 1 ? "1 row" : `${skippedRows.toLocaleString()} rows`
    const verb = skippedRows === 1 ? "was" : "were"
    return `${rows} couldn't be read and ${verb} left out.`
  }
  if (source.repair === "fill-missing-values") {
    return "Some rows had too few values, so the gaps are shown as null."
  }
  return undefined
}

type DataViewProps = {
  table: OpenedTable
  profile?: ColumnProfile[]
  footerAction?: React.ReactNode
}

export function DataView({ table, profile, footerAction }: DataViewProps) {
  const [visible, setVisible] = useState({ first: 0, last: 0 })
  const showVisibleRows = useCallback(
    (first: number, last: number) => setVisible({ first, last }),
    []
  )
  const note = repairNote(table) ?? (profile && gapsNote(profile))

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <h1 className="sr-only">{table.name}</h1>
      <DataTable
        table={table}
        profile={profile}
        onVisibleRowsChange={showVisibleRows}
      />
      <footer className="flex h-7 shrink-0 items-center gap-2.5 border-t pr-3 pl-2 text-xs text-subtle tabular-nums">
        <Badge className="bg-primary/15 text-primary uppercase">
          {table.source.format}
        </Badge>
        <span className="shrink-0">
          {table.rowCount.toLocaleString()} rows, {table.columns.length} columns
        </span>
        {note && (
          <span role="status" className="truncate">
            {note}
          </span>
        )}
        {footerAction}
        {table.rowCount > 0 && (
          <span className="ml-auto shrink-0">
            {visible.first.toLocaleString()} to {visible.last.toLocaleString()}
          </span>
        )}
      </footer>
    </div>
  )
}
