import { useCallback, useEffect, useRef, useState } from "react"

import {
  answerAgent,
  askProject,
  readChat,
  saveChat,
  stopAsking,
  type AgentAnswer,
  type AskStep,
  type PastTurn,
  type TimedStep,
  type Turn,
} from "@/features/chat/api"
import { fillReferences } from "@/features/chat/references"
import type { OpenedTable } from "@/features/data"
import { errorKind, toErrorMessage } from "@/lib/ipc-error"

const SAVE_INTERVAL_MS = 1000
const INTERRUPTED = "Davis closed before this finished."

function pastTurn({ question, answer }: Turn): PastTurn[] {
  if (!answer) return []
  const text = fillReferences(answer.text, answer.queries)
  return [
    {
      question,
      answer: [answer.title, text].filter(Boolean).join("\n"),
      queries: Object.values(answer.queries).map(({ sql }) => sql),
    },
  ]
}

type EarlierAnswer = {
  title: string
  sql: string | null
  chart: { kind: "bar" | "line"; x: string; y: string } | null
  result: AgentAnswer["queries"][string]["result"] | null
}

// Chats saved before answers could hold several results.
function currentAnswer(answer: AgentAnswer | EarlierAnswer): AgentAnswer {
  if ("figures" in answer) return answer
  const { title, sql, chart, result } = answer
  if (!result) return { title, text: "", figures: [], queries: {} }
  const isOneValue = result.rows.length === 1 && result.columns.length === 1
  return {
    title,
    text: "",
    figures: [
      {
        query: "q1",
        title,
        view: chart?.kind ?? (isOneValue ? "number" : "table"),
        x: chart?.x ?? null,
        y: chart?.y ?? null,
      },
    ],
    queries: { q1: { sql: sql ?? "", result } },
  }
}

function restoredTurn(turn: Turn): Turn {
  const answer = turn.answer && currentAnswer(turn.answer)
  if (turn.finishedAt) return { ...turn, answer }
  return {
    ...turn,
    answer,
    finishedAt: Date.now(),
    error: INTERRUPTED,
    steps: turn.steps.flatMap((step) => {
      if (step.status !== "running") return [step]
      return step.kind === "note" ? [] : [{ ...step, status: "stopped" }]
    }),
  }
}

function mergeStep(steps: TimedStep[], step: AskStep, now: number) {
  const known = steps.find(({ id }) => id === step.id)
  const finishedAt = step.status === "running" ? undefined : now
  if (!known) return [...steps, { ...step, startedAt: now, finishedAt }]
  return steps.map((item) =>
    item.id === step.id
      ? { ...step, startedAt: item.startedAt, finishedAt }
      : item
  )
}

// Replies arrive a token at a time, so updates wait for the next frame.
function useStepBuffer(onFlush: (id: number, steps: AskStep[]) => void) {
  const buffered = useRef(new Map<number, AskStep[]>())
  const frame = useRef(0)

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const flush = useCallback(() => {
    frame.current = 0
    const pending = [...buffered.current]
    buffered.current.clear()
    for (const [id, steps] of pending) onFlush(id, steps)
  }, [onFlush])

  const add = useCallback(
    (id: number, step: AskStep) => {
      buffered.current.set(id, [...(buffered.current.get(id) ?? []), step])
      if (!frame.current) frame.current = requestAnimationFrame(flush)
    },
    [flush]
  )

  return { add, flush }
}

export function useChat(
  project: string | undefined,
  table: OpenedTable | undefined,
  onSaved: (project: string) => void
) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [chatId, setChatId] = useState<string>()
  const [saveError, setSaveError] = useState<string>()
  const savedTurns = useRef(turns)
  const lastSave = useRef(0)
  const nextId = useRef(1)
  const activeId = turns.find((turn) => !turn.finishedAt)?.id
  const isAsking = activeId !== undefined

  useEffect(() => {
    if (!project || !chatId) return
    if (turns.length === 0 || turns === savedTurns.current) return
    const now = Date.now()
    if (isAsking && now - lastSave.current < SAVE_INTERVAL_MS) return
    lastSave.current = now
    savedTurns.current = turns
    const [first] = turns
    saveChat(project, {
      id: chatId,
      title: first.answer?.title || first.question,
      updatedAt: now,
      table: table?.name ?? null,
      turns,
    })
      .then(() => {
        setSaveError(undefined)
        onSaved(project)
      })
      .catch((failure: unknown) => setSaveError(toErrorMessage(failure)))
  }, [chatId, isAsking, onSaved, project, table?.name, turns])

  const update = useCallback(
    (id: number, change: (turn: Turn) => Partial<Turn>) =>
      setTurns((current) =>
        current.map((turn) =>
          turn.id === id ? { ...turn, ...change(turn) } : turn
        )
      ),
    []
  )

  const applySteps = useCallback(
    (id: number, steps: AskStep[]) =>
      update(id, (turn) => ({
        steps: steps.reduce(
          (merged, step) => mergeStep(merged, step, Date.now()),
          turn.steps
        ),
      })),
    [update]
  )
  const buffer = useStepBuffer(applySteps)

  const run = useCallback(
    async (id: number, question: string) => {
      if (!project) return
      const history = turns.flatMap((turn) =>
        turn.id === id ? [] : pastTurn(turn)
      )
      try {
        const answer = await askProject(
          id,
          project,
          { question, activeTable: table?.name ?? null, history },
          (step) => buffer.add(id, step)
        )
        buffer.flush()
        update(id, (turn) =>
          turn.isStopped
            ? {}
            : {
                answer,
                finishedAt: Date.now(),
                steps: turn.steps.filter(
                  ({ kind, status }) => kind !== "note" || status !== "running"
                ),
              }
        )
      } catch (failure) {
        buffer.flush()
        update(id, (turn) => ({
          finishedAt: turn.finishedAt ?? Date.now(),
          isStopped: turn.isStopped || errorKind(failure) === "stopped",
          error:
            errorKind(failure) === "stopped"
              ? undefined
              : toErrorMessage(failure),
        }))
      }
    },
    [buffer, project, table?.name, turns, update]
  )

  const ask = useCallback(
    (question: string) => {
      const id = nextId.current
      nextId.current += 1
      setChatId((current) => current ?? crypto.randomUUID())
      setTurns((current) => [
        ...current,
        { id, question, steps: [], startedAt: Date.now() },
      ])
      void run(id, question)
    },
    [run]
  )

  const retry = useCallback(
    (turn: Turn) => {
      update(turn.id, () => ({
        steps: [],
        error: undefined,
        isStopped: false,
        finishedAt: undefined,
        startedAt: Date.now(),
      }))
      void run(turn.id, turn.question)
    },
    [run, update]
  )

  const reply = useCallback(
    (text: string) => {
      if (activeId === undefined) return
      answerAgent(activeId, text).catch((failure: unknown) =>
        setSaveError(toErrorMessage(failure))
      )
    },
    [activeId]
  )

  const stop = useCallback(() => {
    if (activeId === undefined) return
    update(activeId, () => ({ isStopped: true, finishedAt: Date.now() }))
    stopAsking(activeId).catch((error: unknown) =>
      console.error("Could not stop the question", error)
    )
  }, [activeId, update])

  const clear = useCallback(() => {
    savedTurns.current = []
    setTurns([])
    setChatId(undefined)
    setSaveError(undefined)
  }, [])

  const open = useCallback(async (projectPath: string, id: string) => {
    const chat = await readChat(projectPath, id)
    const restored = chat.turns.map(restoredTurn)
    savedTurns.current = restored
    nextId.current = Math.max(0, ...restored.map((turn) => turn.id)) + 1
    setTurns(restored)
    setChatId(id)
    setSaveError(undefined)
    return chat
  }, [])

  return {
    turns,
    chatId,
    saveError,
    isAsking,
    ask,
    retry,
    reply,
    stop,
    clear,
    open,
  }
}
