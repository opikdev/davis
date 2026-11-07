import { invoke } from "@tauri-apps/api/core"

export type ColumnKind = "number" | "date" | "boolean" | "text" | "other"

export type Column = {
  name: string
  dataType: string
  kind: ColumnKind
}

export type TableSource = {
  path: string
  format: string
  encoding: string
  repair: "none" | "fill-missing-values" | "skip-bad-rows"
}

export type OpenedTable = {
  source: TableSource
  name: string
  rowCount: number
  skippedRows: number
  columns: Column[]
}

export type Row = (string | null)[]

export function openTable(path: string) {
  return invoke<OpenedTable>("open_table", { path })
}

export function readRows(source: TableSource, offset: number, limit: number) {
  return invoke<Row[]>("read_rows", { source, offset, limit })
}
