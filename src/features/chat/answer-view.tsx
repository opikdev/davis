import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { AnswerChart } from "@/features/chat/answer-chart"
import type { TableAnswer } from "@/features/chat/api"
import { cn } from "@/lib/utils"

const PREVIEW_ROWS = 8

function ResultTable({
  result,
}: {
  result: NonNullable<TableAnswer["result"]>
}) {
  const { columns, rows, isTruncated } = result
  const shown = rows.slice(0, PREVIEW_ROWS)
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
      {rows.length > PREVIEW_ROWS && (
        <p className="text-xs text-subtle">
          First {PREVIEW_ROWS} of {total} rows
        </p>
      )}
    </div>
  )
}

export function AnswerView({ answer }: { answer: TableAnswer }) {
  const { title, result } = answer
  const single =
    result?.rows.length === 1 && result.columns.length === 1
      ? result.rows[0][0]
      : undefined

  return (
    <div className="flex animate-fade flex-col gap-2">
      <h2 className="font-medium select-text">{title}</h2>
      {single !== undefined ? (
        <p className="text-2xl font-medium tabular-nums select-text">
          {single ?? "null"}
        </p>
      ) : (
        result && (
          <>
            <AnswerChart answer={answer} />
            <ResultTable result={result} />
          </>
        )
      )}
    </div>
  )
}
