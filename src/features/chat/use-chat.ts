import { useCallback, useEffect, useRef, useState } from "react"

import {
  askAboutTable,
  readChat,
  saveChat,
  stopAsking,
  type AskStep,
  type TimedStep,
  type Turn,
} from "@/features/chat/api"
import type { OpenedTable } from "@/features/data"
import { errorKind, toErrorMessage } from "@/lib/ipc-error"

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
  const nextId = useRef(1)
  const activeId = turns.find((turn) => !turn.finishedAt)?.id
  const isAsking = activeId !== undefined

  useEffect(() => {
    if (!project || !chatId || isAsking) return
    if (turns.length === 0 || turns === savedTurns.current) return
    savedTurns.current = turns
    const [first] = turns
    saveChat(project, {
      id: chatId,
      title: first.answer?.title ?? first.question,
      updatedAt: Date.now(),
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
    savedTurns.current = chat.turns
    nextId.current = Math.max(0, ...chat.turns.map((turn) => turn.id)) + 1
    setTurns(chat.turns)
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
    stop,
    clear,
    open,
  }
}
