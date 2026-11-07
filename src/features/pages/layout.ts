import type { Block, PageRow } from "@/features/pages/api"

export const MAX_BLOCKS_IN_ROW = 4

export type DropTarget =
  | { kind: "new-row"; index: number }
  | { kind: "in-row"; rowId: string; index: number }

function withoutBlock(rows: PageRow[], id: string) {
  return rows.map((row) => ({
    ...row,
    blocks: row.blocks.filter((block) => block.id !== id),
  }))
}

export function findBlock(rows: PageRow[], id: string | undefined) {
  return rows.flatMap((row) => row.blocks).find((block) => block.id === id)
}

export function rowFor(block: Block): PageRow {
  return { id: `row-${block.id}`, blocks: [block] }
}

// A block landing in a full row stays where it was, so a drop can't lose it.
export function moveBlock(rows: PageRow[], id: string, target: DropTarget) {
  const block = findBlock(rows, id)
  if (!block) return rows

  if (target.kind === "new-row") {
    const before = rows.slice(0, target.index).map((row) => ({
      ...row,
      blocks: row.blocks.filter((item) => item.id !== id),
    }))
    const after = rows.slice(target.index).map((row) => ({
      ...row,
      blocks: row.blocks.filter((item) => item.id !== id),
    }))
    return [...before, rowFor(block), ...after].filter(
      (row) => row.blocks.length > 0
    )
  }

  const destination = rows.find((row) => row.id === target.rowId)
  if (!destination) return rows
  const isSameRow = destination.blocks.some((item) => item.id === id)
  if (!isSameRow && destination.blocks.length >= MAX_BLOCKS_IN_ROW) return rows

  const position = isSameRow
    ? destination.blocks.findIndex((item) => item.id === id)
    : -1
  const index =
    position >= 0 && position < target.index ? target.index - 1 : target.index

  return withoutBlock(rows, id)
    .map((row) =>
      row.id === target.rowId
        ? { ...row, blocks: row.blocks.toSpliced(index, 0, block) }
        : row
    )
    .filter((row) => row.blocks.length > 0)
}

export function changeBlock(
  rows: PageRow[],
  id: string,
  change: Partial<Block>
) {
  return rows.map((row) => ({
    ...row,
    blocks: row.blocks.map((block) =>
      block.id === id ? { ...block, ...change } : block
    ),
  }))
}

export function removeBlock(rows: PageRow[], id: string) {
  return withoutBlock(rows, id).filter((row) => row.blocks.length > 0)
}
