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

export type ColumnProfile = {
  name: string
  kind: ColumnKind
  missingPercent: number
  uniqueValues: number
  min: string | null
  max: string | null
  mean: string | null
}

export type ValueCount = {
  label: string
  count: number
}

export function openTable(path: string) {
  return invoke<OpenedTable>("open_table", { path })
}

export function readRows(source: TableSource, offset: number, limit: number) {
  return invoke<Row[]>("read_rows", { source, offset, limit })
}

export function profileTable(source: TableSource) {
  return invoke<ColumnProfile[]>("profile_table", { source })
}

export function columnValues(
  source: TableSource,
  column: string,
  kind: ColumnKind
) {
  return invoke<ValueCount[]>("column_values", { source, column, kind })
}
