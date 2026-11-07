import { useCallback, useEffect, useRef, useState } from "react"

import {
  askAboutTable,
  stopAsking,
  type AskStep,
  type TableAnswer,
} from "@/features/chat/api"
import type { OpenedTable } from "@/features/data"
import { errorKind, toErrorMessage } from "@/lib/ipc-error"

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

export function useChat(table: OpenedTable | undefined) {
  const [turns, setTurns] = useState<Turn[]>([])
  const nextId = useRef(1)
  const activeId = turns.find((turn) => !turn.finishedAt)?.id
  const isAsking = activeId !== undefined

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
      if (!table) return
      const history = turns.flatMap((turn) =>
        turn.id !== id && turn.answer?.sql
          ? [{ question: turn.question, sql: turn.answer.sql }]
          : []
      )
      try {
        const answer = await askAboutTable(
          id,
          table.source,
          {
            question,
            columns: table.columns.map(({ name, dataType }) => ({
              name,
              dataType,
            })),
            history,
          },
          (step) => buffer.add(id, step)
        )
        buffer.flush()
        update(id, (turn) =>
          turn.isStopped ? {} : { answer, finishedAt: Date.now() }
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
    [buffer, table, turns, update]
  )

  const ask = useCallback(
    (question: string) => {
      const id = nextId.current
      nextId.current += 1
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

  const stop = useCallback(() => {
    if (activeId === undefined) return
    update(activeId, () => ({ isStopped: true, finishedAt: Date.now() }))
    stopAsking(activeId).catch((error: unknown) =>
      console.error("Could not stop the question", error)
    )
  }, [activeId, update])

  const clear = useCallback(() => setTurns([]), [])

  // A conversation belongs to one file.
  const path = table?.source.path
  useEffect(() => setTurns([]), [path])

  return { turns, isAsking, ask, retry, stop, clear }
}
