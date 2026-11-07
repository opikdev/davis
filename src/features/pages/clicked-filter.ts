import type { Grain, PageFilter, ProjectColumns } from "@/features/pages/api"
import { shiftDays } from "@/features/pages/format"

const DAYS_AFTER_WEEK_START = 6
const MONTHS_AFTER_QUARTER_START = 2

function periodRange(label: string, grain: Grain | null | undefined) {
  const quarter = /^(\d{4})-Q([1-4])$/.exec(label)
  if (quarter) {
    const first = (Number(quarter[2]) - 1) * 3 + 1
    const month = (number: number) => String(number).padStart(2, "0")
    return {
      from: `${quarter[1]}-${month(first)}`,
      to: `${quarter[1]}-${month(first + MONTHS_AFTER_QUARTER_START)}`,
    }
  }
  if (grain === "week") {
    return { from: label, to: shiftDays(label, DAYS_AFTER_WEEK_START) }
  }
  return /^\d{4}(-\d{2}(-\d{2})?)?$/.test(label)
    ? { from: label, to: label }
    : undefined
}

export function clickedFilter(
  tables: ProjectColumns[],
  column: string,
  label: string,
  grain?: Grain | null
): PageFilter | undefined {
  for (const { table, columns } of tables) {
    const found = columns.find(({ name }) => name === column)
    if (!found) continue
    const shared = {
      id: `clicked-${column}`,
      table,
      column,
      values: [label],
    }
    if (found.kind !== "date") {
      return { ...shared, kind: "values", from: null, to: null }
    }
    const range = periodRange(label, grain)
    return range && { ...shared, kind: "dates", ...range }
  }
  return undefined
}
