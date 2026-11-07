import { expect, test } from "vitest"

import type { ProjectColumns } from "@/features/pages/api"
import { clickedFilter } from "@/features/pages/clicked-filter"

const TABLES: ProjectColumns[] = [
  {
    table: "orders.csv",
    columns: [
      { name: "ordered_at", dataType: "DATE", kind: "date" },
      { name: "region", dataType: "VARCHAR", kind: "text" },
    ],
  },
]

test("a clicked group filters on that exact value", () => {
  expect(clickedFilter(TABLES, "region", "EMEA")).toMatchObject({
    table: "orders.csv",
    kind: "values",
    values: ["EMEA"],
  })
})

test("a clicked month covers the whole month", () => {
  expect(clickedFilter(TABLES, "ordered_at", "2026-03", "month")).toMatchObject(
    { kind: "dates", from: "2026-03", to: "2026-03", values: ["2026-03"] }
  )
})

test("a clicked quarter covers its three months", () => {
  expect(
    clickedFilter(TABLES, "ordered_at", "2026-Q2", "quarter")
  ).toMatchObject({ kind: "dates", from: "2026-04", to: "2026-06" })
})

test("a clicked week covers the seven days from its start", () => {
  expect(
    clickedFilter(TABLES, "ordered_at", "2026-12-28", "week")
  ).toMatchObject({ from: "2026-12-28", to: "2027-01-03" })
})

test("a date label Davis can't read as a period is left alone", () => {
  expect(clickedFilter(TABLES, "ordered_at", "March", null)).toBeUndefined()
})

test("a column in no file is left alone", () => {
  expect(clickedFilter(TABLES, "total", "5")).toBeUndefined()
})
