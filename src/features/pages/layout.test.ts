import { describe, expect, test } from "vitest"

import type { Block, PageRow } from "@/features/pages/api"
import { changeBlock, moveBlock, removeBlock } from "@/features/pages/layout"

function row(id: string, ...blocks: string[]): PageRow {
  return {
    id,
    blocks: blocks.map((blockId) => ({ id: blockId }) as Block),
  }
}

function shape(rows: PageRow[]) {
  return rows.map(({ blocks }) => blocks.map(({ id }) => id))
}

const ROWS = [row("r1", "a", "b"), row("r2", "c"), row("r3", "d")]

describe("moveBlock", () => {
  test("moves a block beside others in another row", () => {
    const moved = moveBlock(ROWS, "c", {
      kind: "in-row",
      rowId: "r1",
      index: 1,
    })

    expect(shape(moved)).toEqual([["a", "c", "b"], ["d"]])
  })

  test("reorders inside a row, moving right", () => {
    const moved = moveBlock(ROWS, "a", {
      kind: "in-row",
      rowId: "r1",
      index: 2,
    })

    expect(shape(moved)[0]).toEqual(["b", "a"])
  })

  test("reorders inside a row, moving left", () => {
    const moved = moveBlock(ROWS, "b", {
      kind: "in-row",
      rowId: "r1",
      index: 0,
    })

    expect(shape(moved)[0]).toEqual(["b", "a"])
  })

  test("gives a block its own row at the top", () => {
    const moved = moveBlock(ROWS, "b", { kind: "new-row", index: 0 })

    expect(shape(moved)).toEqual([["b"], ["a"], ["c"], ["d"]])
  })

  test("gives a block its own row at the bottom and drops the empty one", () => {
    const moved = moveBlock(ROWS, "c", { kind: "new-row", index: 3 })

    expect(shape(moved)).toEqual([["a", "b"], ["d"], ["c"]])
  })

  test("a full row refuses another block and nothing is lost", () => {
    const full = [row("r1", "a", "b", "c", "d"), row("r2", "e")]

    const moved = moveBlock(full, "e", {
      kind: "in-row",
      rowId: "r1",
      index: 0,
    })

    expect(shape(moved)).toEqual([["a", "b", "c", "d"], ["e"]])
  })

  test("a full row can still reorder itself", () => {
    const full = [row("r1", "a", "b", "c", "d")]

    const moved = moveBlock(full, "d", {
      kind: "in-row",
      rowId: "r1",
      index: 0,
    })

    expect(shape(moved)).toEqual([["d", "a", "b", "c"]])
  })

  test("an unknown block or row changes nothing", () => {
    expect(moveBlock(ROWS, "nope", { kind: "new-row", index: 0 })).toBe(ROWS)
    expect(
      moveBlock(ROWS, "a", { kind: "in-row", rowId: "nope", index: 0 })
    ).toBe(ROWS)
  })

  test("every block survives any move", () => {
    const ids = ["a", "b", "c", "d"]
    for (const id of ids) {
      for (const index of [0, 1, 2, 3]) {
        const moved = moveBlock(ROWS, id, { kind: "new-row", index })
        expect(shape(moved).flat().toSorted()).toEqual(ids)
      }
    }
  })
})

test("removing the last block in a row removes the row", () => {
  expect(shape(removeBlock(ROWS, "c"))).toEqual([["a", "b"], ["d"]])
})

test("changing a block leaves the others alone", () => {
  const changed = changeBlock(ROWS, "a", { title: "New" })

  expect(changed[0].blocks[0].title).toBe("New")
  expect(changed[0].blocks[1].title).toBeUndefined()
})
