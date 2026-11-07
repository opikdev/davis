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
import { useEffect, useState } from "react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { ResultTable } from "@/features/chat/answer-view"
import type { AskStep, StoredQuery, TimedStep, Turn } from "@/features/chat/api"
import { withoutReferences } from "@/features/chat/references"
import { cn } from "@/lib/utils"

const KIND_ICONS: Record<AskStep["kind"], IconSvgElement> = {
  read: Table01Icon,
  think: AiBrain01Icon,
  note: Note01Icon,
  question: HelpCircleIcon,
  write: CodeIcon,
  run: PlayIcon,
  chart: ChartBarLineIcon,
}

function seconds(from: number, to: number) {
  return `${Math.max(Math.round((to - from) / 1000), 1)}s`
}

function useNow(isRunning: boolean) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!isRunning) return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [isRunning])

  return now
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

function NoteRow({ step }: { step: TimedStep }) {
  return (
    <p className="py-0.5 pl-5 text-xs/relaxed text-muted-foreground select-text">
      {withoutReferences(step.body ?? "")}
    </p>
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

function stepLabel(step: TimedStep) {
  if (step.kind !== "think" || step.status === "running") return step.label
  return `Thought for ${seconds(step.startedAt, step.finishedAt ?? step.startedAt)}`
}

type StepRowProps = {
  step: TimedStep
  queries?: Record<string, StoredQuery>
}

function StepRow({ step, queries }: StepRowProps) {
  if (step.kind === "note") return <NoteRow step={step} />

  const row = (
    <>
      <HugeiconsIcon
        icon={KIND_ICONS[step.kind]}
        strokeWidth={1.5}
        className="size-3.5 shrink-0 text-subtle"
      />
      <span
        className={cn(
          "shrink-0",
          step.status === "running" && "text-foreground",
          step.status === "failed" && "text-destructive"
        )}
      >
        {stepLabel(step)}
      </span>
      {step.detail && (
        <span className="min-w-0 truncate text-subtle">{step.detail}</span>
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
          "group/step rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
        )}
      >
        {row}
        {step.status !== "running" && (
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            strokeWidth={1.5}
            className="ml-auto size-3 shrink-0 text-subtle transition-transform group-data-panel-open/step:rotate-90"
          />
        )}
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

function WorkingStatus({ turn }: { turn: Turn }) {
  const now = useNow(true)
  const current = turn.steps.findLast(
    ({ kind, status }) => status === "running" && kind !== "note"
  )
  const label =
    current?.kind === "question"
      ? "Waiting for your reply"
      : (current?.label ?? "Working")

  return (
    <div
      role="status"
      className="flex h-6 items-center gap-2 text-xs text-muted-foreground"
    >
      <WorkingBars />
      <span className="truncate">{label}</span>
      <span className="ml-auto text-subtle tabular-nums">
        {seconds(turn.startedAt, now)}
      </span>
    </div>
  )
}

export function Activity({ turn }: { turn: Turn }) {
  const isWorking = !turn.finishedAt

  if (isWorking) {
    return (
      <div className="flex animate-fade flex-col">
        {turn.steps
          .filter(
            ({ kind, status }) => kind !== "question" || status !== "running"
          )
          .map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
        <WorkingStatus turn={turn} />
      </div>
    )
  }

  if (turn.steps.length === 0) return null

  return (
    <Collapsible>
      <CollapsibleTrigger className="group/worked flex h-6 items-center gap-1 rounded-sm text-xs text-subtle outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40">
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          strokeWidth={1.5}
          className="size-3 transition-transform group-data-panel-open/worked:rotate-90"
        />
        Worked for {seconds(turn.startedAt, turn.finishedAt ?? turn.startedAt)}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-0.5 flex flex-col border-l pl-2">
          {turn.steps.map((step) => (
            <StepRow key={step.id} step={step} queries={turn.answer?.queries} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
