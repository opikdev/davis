import type { QueryResult } from "@/features/chat"
import type { Block } from "@/features/pages/api"

export const FORMATS = [
  { value: "number", label: "Number" },
  { value: "percent", label: "Percent" },
  { value: "USD", label: "US dollars" },
  { value: "EUR", label: "Euros" },
  { value: "GBP", label: "Pounds" },
  { value: "IDR", label: "Rupiah" },
  { value: "JPY", label: "Yen" },
]

const COMPACT_FROM = 100_000

export function formatNumber(
  value: number,
  format: string | null,
  isCompact = false
) {
  const notation = isCompact && Math.abs(value) >= COMPACT_FROM
  if (format === "percent") {
    return value.toLocaleString(undefined, {
      style: "percent",
      maximumFractionDigits: 1,
    })
  }
  if (format && format !== "number") {
    return value.toLocaleString(undefined, {
      style: "currency",
      currency: format,
      notation: notation ? "compact" : "standard",
      maximumFractionDigits: notation ? 1 : 0,
    })
  }
  return value.toLocaleString(undefined, {
    notation: notation ? "compact" : "standard",
    maximumFractionDigits: notation ? 1 : 2,
  })
}

export function formatValue(value: string | null, format: string | null) {
  if (value === null) return "No value"
  const number = Number(value)
  return value.trim() === "" || Number.isNaN(number)
    ? value
    : formatNumber(number, format)
}

// Sorting and top N work on the finished rows, so they apply to any block.
export function arrangedRows(block: Block, result: QueryResult) {
  const yIndex = result.columns.findIndex(({ name }) => name === block.yColumn)
  const xIndex = result.columns.findIndex(({ name }) => name === block.xColumn)
  let rows = result.rows
  if (block.sort === "value" && yIndex >= 0) {
    rows = rows.toSorted((a, b) => Number(b[yIndex]) - Number(a[yIndex]))
  }
  if (block.sort === "label" && xIndex >= 0) {
    rows = rows.toSorted((a, b) =>
      String(a[xIndex]).localeCompare(String(b[xIndex]), undefined, {
        numeric: true,
      })
    )
  }
  return block.limit ? rows.slice(0, block.limit) : rows
}

export type Change = {
  period: string
  value: number
  percent: number | null
}

export function latestChange(trend: QueryResult | null): Change | undefined {
  if (!trend || trend.rows.length === 0) return undefined
  const values = trend.rows.map((row) => Number(row[1]))
  const value = values[values.length - 1]
  const previous = values[values.length - 2]
  return {
    period: trend.rows[trend.rows.length - 1][0] ?? "",
    value,
    percent:
      previous === undefined || previous === 0
        ? null
        : (value - previous) / Math.abs(previous),
  }
}

export const DAY_LENGTH = "2026-01-01".length

export function shiftDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, DAY_LENGTH)
}
