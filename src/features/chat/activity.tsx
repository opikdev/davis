import {
  AiBrain01Icon,
  ArrowRight01Icon,
  ChartBarLineIcon,
  CodeIcon,
  HelpCircleIcon,
  Note01Icon,
  PlayIcon,
  Table01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { useCallback, useState } from "react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { ResultTable } from "@/features/chat/answer-view"
import type { AskStep, StoredQuery, TimedStep, Turn } from "@/features/chat/api"
import { withoutReferences } from "@/features/chat/references"
import { cn } from "@/lib/utils"

const TICK_MS = 1000
const MINUTE = 60

const KIND_ICONS: Record<AskStep["kind"], IconSvgElement> = {
  read: Table01Icon,
  think: AiBrain01Icon,
  note: Note01Icon,
  question: HelpCircleIcon,
  write: CodeIcon,
  run: PlayIcon,
  chart: ChartBarLineIcon,
}

function duration(from: number, to: number) {
  const seconds = Math.max(Math.round((to - from) / 1000), 1)
  if (seconds < MINUTE) return `${seconds}s`
  return `${Math.floor(seconds / MINUTE)}m ${seconds % MINUTE}s`
}

function counted(count: number, unit: string) {
  return `${count} ${unit}${count === 1 ? "" : "s"}`
}

function workSummary(steps: TimedStep[]) {
  const finished = ({ status }: TimedStep) => status === "done"
  const queries = steps.filter(
    (step) => step.kind === "run" && finished(step)
  ).length
  const views = steps.filter(
    (step) => step.kind === "chart" && finished(step)
  ).length
  return [queries && counted(queries, "query"), views && counted(views, "view")]
    .filter(Boolean)
    .join(", ")
    .replace("querys", "queries")
}

function WorkingBars() {
  return (
    <span aria-hidden="true" className="flex h-3 shrink-0 items-center gap-0.5">
      {[0, 1, 2].map((bar) => (
        <span
          key={bar}
          className="h-full w-0.5 animate-wave rounded-full bg-primary"
          style={{ animationDelay: `${bar * 140}ms` }}
        />
      ))}
    </span>
  )
}

function WhatTheAiSaw({ rows, query }: { rows: number; query?: StoredQuery }) {
  const unit = rows === 1 ? "row" : "rows"
  return (
    <div className="mb-1 ml-5 flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">
        The AI saw {rows} {unit} of this result
      </p>
      {query && <ResultTable result={query.result} rowLimit={rows} />}
    </div>
  )
}

type StepRowProps = {
  step: TimedStep
  queries?: Record<string, StoredQuery>
}

function StepRow({ step, queries }: StepRowProps) {
  if (step.kind === "note") {
    return (
      <p className="py-0.5 pl-5 text-xs/relaxed text-muted-foreground select-text">
        {withoutReferences(step.body ?? "")}
      </p>
    )
  }

  const row = (
    <>
      <HugeiconsIcon
        icon={KIND_ICONS[step.kind]}
        strokeWidth={1.5}
        className="size-3.5 shrink-0 text-subtle"
      />
      <span
        className={cn(
          "min-w-0 truncate",
          step.status === "running" && "text-foreground"
        )}
      >
        {step.label}
      </span>
      {step.detail && (
        <span className="ml-auto shrink-0 truncate pl-1 text-subtle">
          {step.detail}
        </span>
      )}
    </>
  )
  const rowClass =
    "flex h-6 w-full items-center gap-1.5 text-left text-xs text-muted-foreground"

  if (!step.body) return <div className={rowClass}>{row}</div>

  return (
    <Collapsible defaultOpen={step.kind === "write"}>
      <CollapsibleTrigger
        className={cn(
          rowClass,
          "rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
        )}
      >
        {row}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-0.5 mb-1 ml-5 rounded-md border bg-sidebar px-2 py-1.5 font-mono text-[0.6875rem]/relaxed break-words whitespace-pre-wrap text-muted-foreground select-text">
          {step.body}
        </pre>
        {step.sentRows != null && (
          <WhatTheAiSaw
            rows={step.sentRows}
            query={step.query ? queries?.[step.query] : undefined}
          />
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

// The timer writes to the page directly, so ticking never re-renders the chat.
function useElapsedText(startedAt: number) {
  return useCallback(
    (node: HTMLElement | null) => {
      if (!node) return
      const write = () => {
        node.textContent = `Working for ${duration(startedAt, Date.now())}`
      }
      write()
      const timer = setInterval(write, TICK_MS)
      return () => clearInterval(timer)
    },
    [startedAt]
  )
}

function Chevron({ className }: { className?: string }) {
  return (
    <HugeiconsIcon
      icon={ArrowRight01Icon}
      strokeWidth={1.5}
      className={cn("size-3 shrink-0 transition-transform", className)}
    />
  )
}

function WorkingActivity({ turn }: { turn: Turn }) {
  const [isOpen, setIsOpen] = useState(false)
  const elapsed = useElapsedText(turn.startedAt)
  const isWaiting = turn.steps.some(
    ({ kind, status }) => kind === "question" && status === "running"
  )
  const log = turn.steps.filter(
    ({ kind, status }) =>
      status !== "running" || (kind !== "note" && kind !== "question")
  )
  const latest = log.findLast(({ kind }) => kind !== "note")
  const streaming = turn.steps.findLast(
    ({ kind, status }) => kind === "note" && status === "running"
  )

  return (
    <div className="flex animate-fade flex-col">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger className="group/working flex h-6 w-full items-center gap-2 rounded-sm text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40">
          <WorkingBars />
          {isWaiting ? (
            <span>Waiting for your reply</span>
          ) : (
            <span ref={elapsed} className="tabular-nums" />
          )}
          <Chevron className="group-data-panel-open/working:rotate-90" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-0.5 flex flex-col border-l pl-2">
            {log.map((step) => (
              <StepRow key={step.id} step={step} />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
      {!isOpen && latest && (
        <div role="status" className="pl-2">
          <StepRow key={latest.id} step={latest} />
        </div>
      )}
      {streaming?.body && (
        <p className="mt-1 leading-relaxed whitespace-pre-wrap text-foreground select-text">
          {withoutReferences(streaming.body)}
        </p>
      )}
    </div>
  )
}

function finishedLabel(turn: Turn) {
  const time = duration(turn.startedAt, turn.finishedAt ?? turn.startedAt)
  if (turn.isStopped) {
    return turn.steps.length > 0
      ? `You stopped after ${time}`
      : "You stopped this"
  }
  return [`Worked for ${time}`, workSummary(turn.steps)]
    .filter(Boolean)
    .join(" · ")
}

export function Activity({ turn }: { turn: Turn }) {
  if (!turn.finishedAt) return <WorkingActivity turn={turn} />

  const log = turn.steps.filter(({ kind, body }) => kind !== "think" || body)
  if (log.length === 0) {
    return turn.isStopped ? (
      <p className="h-6 text-xs/6 text-subtle">{finishedLabel(turn)}</p>
    ) : null
  }

  return (
    <Collapsible defaultOpen={Boolean(turn.error)}>
      <CollapsibleTrigger className="group/worked flex h-6 items-center gap-1 rounded-sm text-xs text-subtle outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40">
        <Chevron className="group-data-panel-open/worked:rotate-90" />
        {finishedLabel(turn)}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-0.5 flex flex-col border-l pl-2">
          {log.map((step) => (
            <StepRow key={step.id} step={step} queries={turn.answer?.queries} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
