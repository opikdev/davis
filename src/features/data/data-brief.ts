import type { ColumnProfile, OpenedTable } from "@/features/data/api"

const DAY_LENGTH = "2026-01-01".length

function count(value: number, unit: string) {
  return `${value.toLocaleString()} ${unit}${value === 1 ? "" : "s"}`
}

function percent(value: number) {
  return value < 0.1 ? "under 0.1%" : `${value.toFixed(1)}%`
}

function dateLine(profile: ColumnProfile[]) {
  const dates = profile.find(
    ({ kind, min, max }) => kind === "date" && min && max
  )
  if (!dates?.min || !dates.max) return undefined
  const [first, last] = [dates.min, dates.max].map((value) =>
    value.slice(0, DAY_LENGTH)
  )
  return first === last
    ? `${dates.name} is all on ${first}.`
    : `${dates.name} runs from ${first} to ${last}.`
}

function worstGap(profile: ColumnProfile[]) {
  return profile
    .filter(({ missingPercent }) => missingPercent > 0)
    .sort((a, b) => b.missingPercent - a.missingPercent)
}

export function gapsNote(profile: ColumnProfile[]) {
  const gaps = worstGap(profile).length
  return gaps > 0 ? `${count(gaps, "column")} with gaps` : undefined
}

function gapsLine(profile: ColumnProfile[]) {
  const gaps = worstGap(profile)
  if (gaps.length === 0) return "No values are missing."
  const [worst] = gaps
  return gaps.length === 1
    ? `${worst.name} is missing ${percent(worst.missingPercent)} of its values.`
    : `${count(gaps.length, "column")} have gaps, most in ${worst.name} (${percent(worst.missingPercent)}).`
}

export function briefLines(table: OpenedTable, profile?: ColumnProfile[]) {
  const size = `${count(table.rowCount, "row")} and ${count(table.columns.length, "column")}.`
  if (!profile) return [size]
  return [size, dateLine(profile), gapsLine(profile)].filter(
    (line) => line !== undefined
  )
}
