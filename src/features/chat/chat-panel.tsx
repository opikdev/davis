import {
  AiChat02Icon,
  ArrowUp02Icon,
  PencilEdit02Icon,
  StopIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { ModelPicker } from "@/features/ai-setup"
import { Activity } from "@/features/chat/activity"
import { AnswerView } from "@/features/chat/answer-view"
import type { Turn } from "@/features/chat/api"
import type { useChat } from "@/features/chat/use-chat"
import type { Column, OpenedTable } from "@/features/data"

function readable(name: string) {
  return name.replace(/[_-]+/g, " ").trim()
}

function suggestionsFor(columns: Column[]) {
  const number = columns.find(({ kind }) => kind === "number")
  const date = columns.find(({ kind }) => kind === "date")
  const text = columns.find(({ kind }) => kind === "text")
  return [
    "How many rows are there?",
    number && date && `Show ${readable(number.name)} over time`,
    number &&
      text &&
      `Compare ${readable(number.name)} by ${readable(text.name)}`,
  ].filter((suggestion) => suggestion !== undefined)
}

function TurnView({ turn, onRetry }: { turn: Turn; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="mb-1 ml-6 w-fit self-end rounded-lg bg-muted px-2.5 py-1.5 select-text">
        {turn.question}
      </p>
      <Activity turn={turn} />
      {turn.answer && <AnswerView answer={turn.answer} />}
      {turn.isStopped && <p className="text-xs text-subtle">Stopped</p>}
      {turn.error && (
        <div role="alert" className="flex flex-col items-start gap-1.5">
          <p className="text-destructive select-text">{turn.error}</p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  )
}

function EmptyChat({
  columns,
  onAsk,
}: {
  columns: Column[]
  onAsk: (question: string) => void
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-2 text-center">
      <HugeiconsIcon
        icon={AiChat02Icon}
        strokeWidth={1.5}
        className="size-5 text-subtle"
      />
      <p className="max-w-56 text-subtle">
        Ask in plain words. The AI sees column names, never your rows.
      </p>
      <div className="flex w-full flex-col gap-1">
        {suggestionsFor(columns).map((suggestion) => (
          <Button
            key={suggestion}
            variant="outline"
            size="sm"
            className="h-auto min-h-6 w-full justify-start py-1 text-left font-normal whitespace-normal text-muted-foreground"
            onClick={() => onAsk(suggestion)}
          >
            {suggestion}
          </Button>
        ))}
      </div>
    </div>
  )
}

type ChatPanelProps = {
  table: OpenedTable
  chat: ReturnType<typeof useChat>
}

export function ChatPanel({ table, chat }: ChatPanelProps) {
  const { turns, saveError, isAsking, ask, retry, reply, stop, clear } = chat
  const [question, setQuestion] = useState("")
  const conversation = useRef<HTMLDivElement>(null)
  const asked = turns
    .at(-1)
    ?.steps.find(
      ({ kind, status }) => kind === "question" && status === "running"
    )
  const canSend = question.trim().length > 0 && (!isAsking || Boolean(asked))

  useEffect(() => {
    const box = conversation.current
    if (box) box.scrollTop = box.scrollHeight
  }, [turns])

  function send() {
    if (!canSend) return
    if (asked) reply(question.trim())
    else ask(question.trim())
    setQuestion("")
  }

  return (
    <aside
      aria-label="Ask AI"
      className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border bg-background"
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b pr-1.5 pl-3">
        <h2 className="text-foreground">Ask AI</h2>
        {turns.length > 0 && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New chat"
            disabled={isAsking}
            onClick={clear}
          >
            <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={1.5} />
          </Button>
        )}
      </div>
      <div
        ref={conversation}
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto mask-y-from-[calc(100%-1rem)] px-3 py-4"
      >
        {turns.length === 0 ? (
          <EmptyChat columns={table.columns} onAsk={ask} />
        ) : (
          turns.map((turn) => (
            <TurnView key={turn.id} turn={turn} onRetry={() => retry(turn)} />
          ))
        )}
        {saveError && (
          <p role="alert" className="text-xs text-destructive select-text">
            This chat couldn't be saved. {saveError}
          </p>
        )}
      </div>
      <div className="shrink-0 p-2 pt-0">
        {asked && (
          <div className="mb-1.5 flex animate-fade flex-col gap-1.5 rounded-xl border bg-sidebar p-2.5">
            <p className="select-text">{asked.label}</p>
            {asked.options && asked.options.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {asked.options.map((option) => (
                  <Button
                    key={option}
                    variant="outline"
                    size="sm"
                    onClick={() => reply(option)}
                  >
                    {option}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
        <InputGroup className="rounded-xl border-border bg-sidebar transition-colors has-[[data-slot=input-group-control]:focus-visible]:border-input has-[[data-slot=input-group-control]:focus-visible]:ring-0">
          <InputGroupTextarea
            aria-label="Ask about this data"
            placeholder={asked ? "Type your reply" : "Ask about this data"}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey) return
              if (event.nativeEvent.isComposing) return
              event.preventDefault()
              send()
            }}
            className="max-h-32 min-h-10 px-2.5 pt-2 pb-0"
          />
          <InputGroupAddon align="block-end" className="justify-between p-1">
            <ModelPicker
              variant="ghost"
              size="sm"
              side="top"
              className="min-w-0 text-muted-foreground"
            />
            {isAsking && (!asked || !question.trim()) ? (
              <InputGroupButton
                variant="secondary"
                size="icon-sm"
                aria-label="Stop"
                className="size-6"
                onClick={stop}
              >
                <HugeiconsIcon
                  icon={StopIcon}
                  strokeWidth={2}
                  className="size-3"
                />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                variant="default"
                size="icon-sm"
                aria-label="Send"
                disabled={!canSend}
                className="size-6"
                onClick={send}
              >
                <HugeiconsIcon
                  icon={ArrowUp02Icon}
                  strokeWidth={2}
                  className="size-3.5"
                />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </div>
    </aside>
  )
}
