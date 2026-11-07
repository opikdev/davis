import { expect, test } from "vitest"

import type { QueryResult } from "@/features/chat"
import type { Block } from "@/features/pages/api"
import { arrangedRows } from "@/features/pages/format"

const column = (name: string) =>
  ({ name, dataType: "VARCHAR", kind: "text" }) as const

function result(rows: string[][]): QueryResult {
  return {
    columns: [column("label"), column("value")],
    rows,
    isTruncated: false,
  }
}

const block = { xColumn: "label", yColumn: "value" } as Block

test("rows sort by label in number order, so 2 comes before 10", () => {
  const rows = [
    ["10", "1"],
    ["2", "2"],
    ["1", "3"],
  ]

  expect(
    arrangedRows({ ...block, sort: "label" }, result(rows)).map(([x]) => x)
  ).toEqual(["1", "2", "10"])
})

test("rows sort by value with the largest first, then keep the top few", () => {
  const rows = [
    ["a", "5"],
    ["b", "50"],
    ["c", "9"],
  ]

  expect(
    arrangedRows({ ...block, sort: "value", limit: 2 }, result(rows)).map(
      ([x]) => x
    )
  ).toEqual(["b", "c"])
})

test("rows keep the order the query gave when no sort is chosen", () => {
  const rows = [
    ["Mon", "5"],
    ["Tue", "50"],
  ]

  expect(arrangedRows({ ...block, sort: null }, result(rows))).toEqual(rows)
})
