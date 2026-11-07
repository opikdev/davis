import { Channel, invoke } from "@tauri-apps/api/core"

import type { Column, Row } from "@/features/data"

export type QueryResult = {
  columns: Column[]
  rows: Row[]
  isTruncated: boolean
}

export type StoredQuery = {
  sql: string
  pageSql?: string | null
  result: QueryResult
}

export type Figure = {
  query: string
  title: string
  view: "bar" | "line" | "number" | "table"
  x: string | null
  y: string | null
}

export type AgentAnswer = {
  title: string
  text: string
  figures: Figure[]
  queries: Record<string, StoredQuery>
  followUps?: string[]
}

export type PastTurn = {
  question: string
  answer: string
  queries: string[]
}

export type AskStep = {
  id: string
  kind:
    "read" | "think" | "note" | "write" | "run" | "chart" | "question" | "page"
  status: "running" | "done" | "failed" | "stopped"
  label: string
  detail: string | null
  body: string | null
  query?: string | null
  sentRows?: number | null
  options?: string[] | null
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
  answer?: AgentAnswer
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

export function askProject(
  turn: number,
  project: string,
  request: {
    question: string
    activeTable: string | null
    activePage: string | null
    activeBlock: string | null
    history: PastTurn[]
  },
  onStep: (step: AskStep) => void
) {
  const steps = new Channel<AskStep>()
  steps.onmessage = onStep
  return invoke<AgentAnswer>("ask_project", {
    turn,
    project,
    request,
    onStep: steps,
  })
}

export function answerAgent(turn: number, reply: string) {
  return invoke<boolean>("answer_agent", { turn, reply })
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
