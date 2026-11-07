import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"

import type { QueryResult } from "@/features/chat"

export type BlockView =
  "bar" | "line" | "area" | "stacked" | "scatter" | "number" | "table"

export type Aggregate =
  "count" | "sum" | "average" | "minimum" | "maximum" | "distinct"

export type Grain = "day" | "week" | "month" | "quarter" | "year"

export type QuerySpec = {
  table: string
  aggregate: Aggregate
  measure: string | null
  by: string | null
  grain: Grain | null
  series: string | null
  trendBy: string | null
  trendGrain: Grain | null
}

export type Block = {
  id: string
  kind: "figure" | "text"
  title: string
  weight: number
  sql: string | null
  trendSql: string | null
  spec: QuerySpec | null
  view: BlockView | null
  xColumn: string | null
  yColumn: string | null
  seriesColumn: string | null
  format: string | null
  showLabels: boolean
  sort: "value" | "label" | null
  limit: number | null
  text: string | null
  sources: Record<string, string>
}

export type PageRow = {
  id: string
  blocks: Block[]
}

export type PageFilter = {
  id: string
  table: string
  column: string
  kind: "values" | "dates"
  values: string[]
  from: string | null
  to: string | null
}

export type Page = {
  id: string
  title: string
  updatedAt: number
  rows: PageRow[]
  filters: PageFilter[]
}

export type BlockResult = {
  id: string
  result: QueryResult | null
  error: string | null
  trend: QueryResult | null
  sources: Record<string, QueryResult>
}

export type PageRun = {
  blocks: BlockResult[]
  filters: { id: string; files: string[] }[]
  dataThrough: string | null
}

export type ProjectColumns = {
  table: string
  columns: { name: string; dataType: string; kind: string }[]
}

export type BuiltQuery = {
  sql: string
  trendSql: string | null
  xColumn: string | null
  yColumn: string
  seriesColumn: string | null
}

export type DraftKind = "overview" | "trends" | "compare" | "report"

export type ExportFormat = "pdf" | "png"

export type ExportImage = {
  data: string
  width: number
  height: number
}

export function exportPage(
  title: string,
  format: ExportFormat,
  images: ExportImage[]
) {
  return invoke<string | null>("export_page", { title, format, images })
}

export function setFullscreen(isFullscreen: boolean) {
  return getCurrentWindow().setFullscreen(isFullscreen)
}

export function savePage(project: string, page: Page) {
  return invoke<void>("save_page", { project, page })
}

export function readPage(project: string, id: string) {
  return invoke<Page>("read_page", { project, id })
}

export function deletePage(project: string, id: string) {
  return invoke<void>("delete_page", { project, id })
}

export function addBlock(
  project: string,
  id: string,
  block: Partial<Block>,
  updatedAt: number
) {
  return invoke<Page>("add_block", { project, id, block, updatedAt })
}

export function runPage(project: string, page: Page) {
  return invoke<PageRun>("run_page", { project, page })
}

export function projectColumns(project: string) {
  return invoke<ProjectColumns[]>("project_columns", { project })
}

export function filterOptions(project: string, table: string, column: string) {
  return invoke<string[]>("filter_options", { project, table, column })
}

export function filterBounds(project: string, table: string, column: string) {
  return invoke<[string, string] | null>("filter_bounds", {
    project,
    table,
    column,
  })
}

export function buildBlockQuery(project: string, spec: QuerySpec) {
  return invoke<BuiltQuery>("build_block_query", { project, spec })
}

export function draftPage(
  project: string,
  id: string,
  kind: DraftKind,
  updatedAt: number
) {
  return invoke<Page>("draft_page", { project, id, kind, updatedAt })
}
