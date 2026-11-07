import { Channel, invoke } from "@tauri-apps/api/core"

import type { Column, Row, TableSource } from "@/features/data"

export type ChartPlan = {
  kind: "bar" | "line"
  x: string
  y: string
}

export type TableAnswer = {
  title: string
  sql: string | null
  chart: ChartPlan | null
  result: {
    columns: Column[]
    rows: Row[]
    isTruncated: boolean
  } | null
}

export type AskTurn = {
  question: string
  sql: string
}

export type AskStep = {
  id: string
  kind: "read" | "think" | "write" | "run" | "chart"
  status: "running" | "done" | "failed" | "stopped"
  label: string
  detail: string | null
  body: string | null
}

export type TimedStep = AskStep & {
  startedAt: number
  finishedAt?: number
}

export type Turn = {
  id: number
  question: string
  startedAt: number
  finishedAt?: number
  steps: TimedStep[]
  answer?: TableAnswer
  error?: string
  isStopped?: boolean
}

export type SavedChat = {
  id: string
  title: string
  updatedAt: number
  table: string | null
  turns: Turn[]
}

export function askAboutTable(
  turn: number,
  source: TableSource,
  request: {
    question: string
    columns: { name: string; dataType: string }[]
    history: AskTurn[]
  },
  onStep: (step: AskStep) => void
) {
  const steps = new Channel<AskStep>()
  steps.onmessage = onStep
  return invoke<TableAnswer>("ask_about_table", {
    turn,
    source,
    request,
    onStep: steps,
  })
}

export function stopAsking(turn: number) {
  return invoke<void>("stop_asking", { turn })
}

export function saveChat(project: string, chat: SavedChat) {
  return invoke<void>("save_chat", { project, chat })
}

export function readChat(project: string, id: string) {
  return invoke<SavedChat>("read_chat", { project, id })
}

export function deleteChat(project: string, id: string) {
  return invoke<void>("delete_chat", { project, id })
}
