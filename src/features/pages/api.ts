import { invoke } from "@tauri-apps/api/core"

import type { QueryResult } from "@/features/chat"

export type Block = {
  id: string
  kind: "figure" | "text" | "filter"
  x: number
  y: number
  w: number
  h: number
  title: string
  sql: string | null
  view: "bar" | "line" | "number" | "table" | null
  xColumn: string | null
  yColumn: string | null
  text: string | null
  table: string | null
  column: string | null
  values: string[]
}

export type Page = {
  id: string
  title: string
  updatedAt: number
  blocks: Block[]
}

export type BlockResult = {
  id: string
  result: QueryResult | null
  error: string | null
}

export type PageRun = {
  blocks: BlockResult[]
  filters: { id: string; files: string[] }[]
}

export type FilterChoice = {
  table: string
  columns: string[]
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

export function filterChoices(project: string) {
  return invoke<FilterChoice[]>("filter_choices", { project })
}

export function filterOptions(project: string, table: string, column: string) {
  return invoke<string[]>("filter_options", { project, table, column })
}
