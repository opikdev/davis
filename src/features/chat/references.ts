import type { StoredQuery } from "@/features/chat/api"

const REFERENCE = /\{\{(q\d+)\.(\d+)\.([^{}]+)\}\}/g

export type Reference = {
  query: string
  row: number
  column: string
}

export type TextPiece = string | Reference

export function splitReferences(text: string): TextPiece[] {
  const pieces: TextPiece[] = []
  let end = 0
  for (const match of text.matchAll(REFERENCE)) {
    const [whole, query, row, column] = match
    if (match.index > end) pieces.push(text.slice(end, match.index))
    pieces.push({ query, row: Number(row), column })
    end = match.index + whole.length
  }
  if (end < text.length) pieces.push(text.slice(end))
  return pieces
}

export function referencedValue(
  { query, row, column }: Reference,
  queries: Record<string, StoredQuery>
) {
  const result = queries[query]?.result
  const index = result?.columns.findIndex(({ name }) => name === column) ?? -1
  if (!result || index < 0) return undefined
  return result.rows[row]?.[index] ?? undefined
}

export function formatValue(value: string) {
  const number = Number(value)
  return value.trim() === "" || Number.isNaN(number)
    ? value
    : number.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export function fillReferences(
  text: string,
  queries: Record<string, StoredQuery>
) {
  return splitReferences(text)
    .map((piece) => {
      if (typeof piece === "string") return piece
      const value = referencedValue(piece, queries)
      return value === undefined ? "unknown" : formatValue(value)
    })
    .join("")
}

export function withoutReferences(text: string) {
  return text.replaceAll(REFERENCE, "…")
}
