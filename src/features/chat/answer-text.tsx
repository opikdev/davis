import { Fragment } from "react"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { StoredQuery } from "@/features/chat/api"
import {
  formatValue,
  referencedValue,
  splitReferences,
  type Reference,
} from "@/features/chat/references"

type Queries = Record<string, StoredQuery>

function NumberSource({
  reference,
  queries,
}: {
  reference: Reference
  queries: Queries
}) {
  const value = referencedValue(reference, queries)
  if (value === undefined) {
    return (
      <span
        className="text-destructive"
        title="The AI pointed at a value Davis can't find."
      >
        missing value
      </span>
    )
  }

  return (
    <Popover>
      <PopoverTrigger
        aria-label={`${formatValue(value)}, show where this comes from`}
        className="rounded-sm font-medium tabular-nums underline decoration-subtle decoration-dotted underline-offset-2 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {formatValue(value)}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-1.5 p-2 text-xs">
        <p className="text-muted-foreground">
          From {reference.column}, row {reference.row + 1} of this query
        </p>
        <pre className="max-h-40 overflow-auto rounded-md border bg-sidebar px-2 py-1.5 font-mono text-[0.6875rem]/relaxed break-words whitespace-pre-wrap text-muted-foreground select-text">
          {queries[reference.query].sql}
        </pre>
      </PopoverContent>
    </Popover>
  )
}

function Line({ text, queries }: { text: string; queries: Queries }) {
  return splitReferences(text).map((piece, index) =>
    typeof piece === "string" ? (
      <Fragment key={index}>{piece}</Fragment>
    ) : (
      <NumberSource key={index} reference={piece} queries={queries} />
    )
  )
}

export function AnswerText({
  text,
  queries,
}: {
  text: string
  queries: Queries
}) {
  const blocks = text.split(/\n\s*\n/).filter((block) => block.trim())

  return (
    <div className="flex flex-col gap-2 leading-relaxed select-text">
      {blocks.map((block, index) => {
        const lines = block.split("\n").filter((line) => line.trim())
        const isList = lines.every((line) => line.trimStart().startsWith("- "))
        return isList ? (
          <ul key={index} className="flex list-disc flex-col gap-1 pl-4">
            {lines.map((line, item) => (
              <li key={item}>
                <Line text={line.trimStart().slice(2)} queries={queries} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={index}>
            <Line text={lines.join(" ")} queries={queries} />
          </p>
        )
      })}
    </div>
  )
}
