import {
  Calendar03Icon,
  CodeIcon,
  HashtagIcon,
  TextIcon,
  ToggleOnIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type {
  Column,
  ColumnKind,
  ColumnProfile,
  OpenedTable,
} from "@/features/data/api"
import { ColumnStats } from "@/features/data/column-stats"
import { TableScrollbar } from "@/features/data/table-scrollbar"
import { useRowPages } from "@/features/data/use-row-pages"
import { useTableScroll } from "@/features/data/use-table-scroll"
import { cn } from "@/lib/utils"

const ROW_HEIGHT = 28
const HEADER_HEIGHT = 30
const EXTRA_ROWS = 6
const COLUMN_STEP = 96
const CHARACTER_WIDTH = 7

const KIND_ICONS: Record<ColumnKind, IconSvgElement> = {
  number: HashtagIcon,
  date: Calendar03Icon,
  boolean: ToggleOnIcon,
  text: TextIcon,
  other: CodeIcon,
}

const KIND_WIDTHS: Record<ColumnKind, number> = {
  number: 96,
  date: 148,
  boolean: 88,
  text: 168,
  other: 168,
}

function columnWidth({ name, kind }: Column) {
  return Math.max(KIND_WIDTHS[kind], name.length * CHARACTER_WIDTH + 44)
}

function useElementSize(element: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const target = element.current
    if (!target) return
    const measure = () =>
      setSize({ width: target.clientWidth, height: target.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(target)
    return () => observer.disconnect()
  }, [element])

  return size
}

type DataTableProps = {
  table: OpenedTable
  profile?: ColumnProfile[]
  onVisibleRowsChange: (first: number, last: number) => void
}

export function DataTable({
  table,
  profile,
  onVisibleRowsChange,
}: DataTableProps) {
  const { columns, rowCount, source } = table
  const element = useRef<HTMLDivElement>(null)
  const { width, height } = useElementSize(element)

  const gutter = Math.max(String(rowCount).length * CHARACTER_WIDTH + 18, 40)
  const contentWidth = columns.reduce(
    (total, column) => total + columnWidth(column),
    gutter
  )
  const tableWidth = Math.max(contentWidth, width)
  const bodyHeight = Math.max(height - HEADER_HEIGHT, 0)
  const maxX = tableWidth - width
  const maxY = rowCount * ROW_HEIGHT - bodyHeight + ROW_HEIGHT
  const { position, moveTo, moveBy } = useTableScroll(element, { maxX, maxY })

  const topRow = Math.floor(position.y / ROW_HEIGHT)
  const visibleRows = Math.ceil(bodyHeight / ROW_HEIGHT)
  const firstRow = Math.max(topRow - EXTRA_ROWS, 0)
  const lastRow = Math.min(
    topRow + visibleRows + EXTRA_ROWS,
    Math.max(rowCount - 1, 0)
  )
  const { rowAt, error, retry } = useRowPages(source, firstRow, lastRow)

  useEffect(() => {
    onVisibleRowsChange(topRow + 1, Math.min(topRow + visibleRows, rowCount))
  }, [onVisibleRowsChange, rowCount, topRow, visibleRows])

  const template = [
    `${gutter}px`,
    ...columns.map((column) => `minmax(${columnWidth(column)}px, 1fr)`),
  ].join(" ")
  const stuck = { transform: `translateX(${position.x}px)` }
  const indexes = Array.from(
    { length: rowCount === 0 ? 0 : lastRow - firstRow + 1 },
    (_, offset) => firstRow + offset
  )

  function scrollWithKeys(event: React.KeyboardEvent) {
    const page = bodyHeight - ROW_HEIGHT
    const moves: Record<string, () => void> = {
      ArrowDown: () => moveBy(0, ROW_HEIGHT),
      ArrowUp: () => moveBy(0, -ROW_HEIGHT),
      ArrowRight: () => moveBy(COLUMN_STEP, 0),
      ArrowLeft: () => moveBy(-COLUMN_STEP, 0),
      PageDown: () => moveBy(0, page),
      PageUp: () => moveBy(0, -page),
      Home: () => moveTo(position.x, 0),
      End: () => moveTo(position.x, maxY),
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    move()
  }

  return (
    <div
      ref={element}
      tabIndex={0}
      role="region"
      aria-label={`Rows of ${table.name}`}
      onKeyDown={scrollWithKeys}
      className="group/table relative min-h-0 flex-1 overflow-hidden outline-none"
    >
      <table
        data-slot="table"
        aria-rowcount={rowCount + 1}
        className="absolute top-0 left-0 grid h-full text-sm will-change-transform"
        style={{
          width: tableWidth,
          transform: `translateX(${-position.x}px)`,
          gridTemplateRows: `${HEADER_HEIGHT}px 1fr`,
        }}
      >
        <TableHeader className="z-10 grid bg-sidebar [&_tr]:border-b">
          <TableRow
            aria-rowindex={1}
            className="grid hover:bg-transparent"
            style={{ gridTemplateColumns: template }}
          >
            <TableHead
              className="z-10 h-auto border-r bg-sidebar"
              style={stuck}
            >
              <span className="sr-only">Row number</span>
            </TableHead>
            {columns.map((column) => (
              <TableHead
                key={column.name}
                className={cn(
                  "flex h-auto items-center gap-1.5 border-r px-2 font-normal text-muted-foreground last:border-r-0",
                  column.kind === "number" && "justify-end"
                )}
              >
                <ColumnStats
                  column={column}
                  source={source}
                  profile={profile?.find(({ name }) => name === column.name)}
                >
                  <HugeiconsIcon
                    icon={KIND_ICONS[column.kind]}
                    strokeWidth={1.5}
                    className="size-3 shrink-0 text-subtle"
                  />
                  <span className="truncate">{column.name}</span>
                </ColumnStats>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody className="relative min-h-0 overflow-hidden">
          {indexes.map((index) => {
            const row = rowAt(index)
            return (
              <TableRow
                key={index}
                aria-rowindex={index + 2}
                className="group/row absolute inset-x-0 top-0 grid h-7 border-b border-border/60 hover:bg-transparent"
                style={{
                  gridTemplateColumns: template,
                  transform: `translateY(${index * ROW_HEIGHT - position.y}px)`,
                }}
              >
                <TableCell
                  className="z-10 flex h-auto items-center justify-end border-r bg-background px-2 text-xs text-subtle tabular-nums"
                  style={stuck}
                >
                  {index + 1}
                </TableCell>
                {columns.map((column, cell) => {
                  const value = row?.[cell]
                  return (
                    <TableCell
                      key={column.name}
                      title={value ?? undefined}
                      className={cn(
                        "flex h-auto min-w-0 items-center border-r px-2 text-foreground select-text group-hover/row:bg-muted/50 last:border-r-0",
                        column.kind === "number" && "justify-end tabular-nums",
                        column.kind === "date" &&
                          "text-muted-foreground tabular-nums"
                      )}
                    >
                      {!row ? (
                        <Skeleton className="h-2.5 w-3/5" />
                      ) : value === null ? (
                        <span className="text-subtle">null</span>
                      ) : (
                        <span className="truncate">{value}</span>
                      )}
                    </TableCell>
                  )
                })}
              </TableRow>
            )
          })}
        </TableBody>
      </table>
      <TableScrollbar
        axis="y"
        position={position.y}
        max={maxY}
        viewport={bodyHeight}
        onChange={(y) => moveTo(position.x, y)}
      />
      <TableScrollbar
        axis="x"
        position={position.x}
        max={maxX}
        viewport={width}
        onChange={(x) => moveTo(x, position.y)}
      />
      {rowCount === 0 && (
        <p className="absolute inset-x-0 top-16 text-center text-muted-foreground">
          This file has column names but no rows.
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="absolute bottom-3 left-3 z-30 flex w-fit items-center gap-3 rounded-xl border bg-popover py-1 pr-1 pl-3 shadow-md"
        >
          {error}
          <Button variant="outline" size="sm" onClick={retry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  )
}
