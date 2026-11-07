import {
  AiChat02Icon,
  ArrowDown02Icon,
  ArrowUp02Icon,
  Copy01Icon,
  PencilEdit02Icon,
  RepeatIcon,
  StopIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { writeText } from "@tauri-apps/plugin-clipboard-manager"
import { memo, useCallback, useState } from "react"

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
import type { AgentAnswer, Turn } from "@/features/chat/api"
import { fillReferences } from "@/features/chat/references"
import type { useChat } from "@/features/chat/use-chat"
import { useFollow } from "@/features/chat/use-follow"
import type { Column, OpenedTable } from "@/features/data"
import { cn } from "@/lib/utils"

const COPIED_MS = 1500

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

function CopyButton({ text, label }: { text: string; label: string }) {
  const [hasCopied, setHasCopied] = useState(false)

  async function copy() {
    await writeText(text)
    setHasCopied(true)
    setTimeout(() => setHasCopied(false), COPIED_MS)
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={hasCopied ? "Copied" : label}
      onClick={() => void copy()}
    >
      <HugeiconsIcon
        icon={hasCopied ? Tick02Icon : Copy01Icon}
        strokeWidth={1.5}
      />
    </Button>
  )
}

function answerAsText({ title, text, queries }: AgentAnswer) {
  return [title, fillReferences(text, queries)].filter(Boolean).join("\n\n")
}

type TurnViewProps = {
  turn: Turn
  isLast: boolean
  onRetry: (turn: Turn) => void
  onAsk: (question: string) => void
}

const TurnView = memo(function TurnView({
  turn,
  isLast,
  onRetry,
  onAsk,
}: TurnViewProps) {
  const { question, answer, error, finishedAt } = turn
  const followUps = isLast ? (answer?.followUps ?? []) : []

  return (
    <div
      className={cn(
        "group/turn flex shrink-0 flex-col gap-1.5",
        isLast && "min-h-[calc(100cqh-2rem)]"
      )}
    >
      <p className="mb-1 ml-6 w-fit self-end rounded-lg bg-muted px-2.5 py-1.5 select-text">
        {question}
      </p>
      <Activity turn={turn} />
      {answer && <AnswerView answer={answer} />}
      {error && (
        <div role="alert" className="flex flex-col items-start gap-1.5">
          <p className="text-destructive select-text">{error}</p>
          <Button variant="outline" size="sm" onClick={() => onRetry(turn)}>
            Try again
          </Button>
        </div>
      )}
      {answer && finishedAt && (
        <div className="-ml-1 flex opacity-0 transition-opacity duration-150 group-focus-within/turn:opacity-100 group-hover/turn:opacity-100">
          <CopyButton text={answerAsText(answer)} label="Copy answer" />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Ask again"
            onClick={() => onRetry(turn)}
          >
            <HugeiconsIcon icon={RepeatIcon} strokeWidth={1.5} />
          </Button>
        </div>
      )}
      {followUps.length > 0 && (
        <div className="flex animate-fade flex-col items-start gap-1">
          {followUps.map((followUp) => (
            <Button
              key={followUp}
              variant="outline"
              size="sm"
              className="h-auto max-w-full py-1 text-left font-normal whitespace-normal"
              onClick={() => onAsk(followUp)}
            >
              {followUp}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
})

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
  const { attach, isFollowing, jumpToEnd, onScroll, onWheel } = useFollow()
  const asked = turns
    .at(-1)
    ?.steps.find(
      ({ kind, status }) => kind === "question" && status === "running"
    )
  const canSend = question.trim().length > 0 && (!isAsking || Boolean(asked))

  function send() {
    if (!canSend) return
    if (asked) {
      reply(question.trim())
    } else {
      startTurn(question.trim())
    }
    setQuestion("")
  }

  const startTurn = useCallback(
    (text: string) => {
      ask(text)
      requestAnimationFrame(jumpToEnd)
    },
    [ask, jumpToEnd]
  )

  function pickOption(key: string) {
    const option = asked?.options?.[Number(key) - 1]
    if (option) reply(option)
    return Boolean(option)
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
      <div className="[container-type:size] relative flex min-h-0 flex-1 flex-col">
        <div
          ref={attach}
          onScroll={onScroll}
          onWheel={onWheel}
          className="min-h-0 flex-1 overflow-y-auto mask-y-from-[calc(100%-1rem)]"
        >
          <div className="flex min-h-full flex-col gap-5 px-3 py-4">
            {turns.length === 0 ? (
              <EmptyChat columns={table.columns} onAsk={startTurn} />
            ) : (
              turns.map((turn, index) => (
                <TurnView
                  key={turn.id}
                  turn={turn}
                  isLast={index === turns.length - 1}
                  onRetry={retry}
                  onAsk={startTurn}
                />
              ))
            )}
            {saveError && (
              <p role="alert" className="text-xs text-destructive select-text">
                This chat couldn't be saved. {saveError}
              </p>
            )}
          </div>
        </div>
        {!isFollowing && (
          <Button
            variant="secondary"
            size="sm"
            className="absolute bottom-2 left-1/2 -translate-x-1/2 animate-fade border [animation-delay:150ms]"
            onClick={jumpToEnd}
          >
            <HugeiconsIcon
              icon={ArrowDown02Icon}
              strokeWidth={1.5}
              data-icon="inline-start"
            />
            Jump to latest
          </Button>
        )}
      </div>
      <div className="shrink-0 p-2 pt-0">
        {asked && (
          <div className="mb-1.5 flex animate-fade flex-col gap-1.5 rounded-xl border bg-sidebar p-2.5">
            <p className="select-text">{asked.label}</p>
            {asked.options && asked.options.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {asked.options.map((option, index) => (
                  <Button
                    key={option}
                    variant="outline"
                    size="sm"
                    aria-label={option}
                    onClick={() => reply(option)}
                  >
                    <span className="text-subtle tabular-nums">
                      {index + 1}
                    </span>
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
              if (event.nativeEvent.isComposing) return
              if (!question && /^[1-9]$/.test(event.key)) {
                if (pickOption(event.key)) event.preventDefault()
                return
              }
              if (event.key !== "Enter" || event.shiftKey) return
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
