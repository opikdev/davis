import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { AnswerChart } from "@/features/chat/answer-chart"
import { AnswerText } from "@/features/chat/answer-text"
import type { AgentAnswer, Figure, QueryResult } from "@/features/chat/api"
import { formatValue } from "@/features/chat/references"
import { cn } from "@/lib/utils"

const PREVIEW_ROWS = 8

export function ResultTable({
  result,
  rowLimit = PREVIEW_ROWS,
}: {
  result: QueryResult
  rowLimit?: number
}) {
  const { columns, rows, isTruncated } = result
  const shown = rows.slice(0, rowLimit)
  const total = `${rows.length.toLocaleString()}${isTruncated ? "+" : ""}`

  return (
    <div className="flex flex-col gap-1">
      <div className="overflow-hidden rounded-lg border">
        <Table className="text-xs">
          <TableHeader className="bg-sidebar">
            <TableRow className="hover:bg-transparent">
              {columns.map((column) => (
                <TableHead
                  key={column.name}
                  className={cn(
                    "h-6 px-2 font-normal text-muted-foreground",
                    column.kind === "number" && "text-right"
                  )}
                >
                  {column.name}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row, index) => (
              <TableRow key={index} className="hover:bg-transparent">
                {columns.map((column, cell) => (
                  <TableCell
                    key={column.name}
                    className={cn(
                      "max-w-32 truncate px-2 py-1 select-text",
                      column.kind === "number" && "text-right tabular-nums"
                    )}
                  >
                    {row[cell] ?? <span className="text-subtle">null</span>}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {rows.length > rowLimit && (
        <p className="text-xs text-subtle">
          First {rowLimit} of {total} rows
        </p>
      )}
    </div>
  )
}

function FigureView({
  figure,
  result,
}: {
  figure: Figure
  result: QueryResult
}) {
  if (figure.view === "number") {
    const column = result.columns.findIndex(({ name }) => name === figure.y)
    const value = result.rows[0]?.[Math.max(column, 0)]
    return (
      <div className="flex flex-col">
        <h3 className="text-xs text-muted-foreground">{figure.title}</h3>
        <p className="text-2xl font-medium tabular-nums select-text">
          {value ? formatValue(value) : "null"}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-xs text-muted-foreground">{figure.title}</h3>
      {figure.view !== "table" && (
        <AnswerChart figure={figure} result={result} />
      )}
      <ResultTable result={result} />
    </div>
  )
}

export function AnswerView({ answer }: { answer: AgentAnswer }) {
  const { title, text, figures, queries } = answer

  return (
    <div className="flex animate-fade flex-col gap-3">
      <div className="flex flex-col gap-1">
        {title && <h2 className="font-medium select-text">{title}</h2>}
        {text && <AnswerText text={text} queries={queries} />}
      </div>
      {figures.map((figure, index) => {
        const query = queries[figure.query]
        return query ? (
          <FigureView key={index} figure={figure} result={query.result} />
        ) : null
      })}
    </div>
  )
}
