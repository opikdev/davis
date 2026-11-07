import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"

import {
  exportPage,
  type BlockResult,
  type ExportFormat,
  type Page,
  type PageFilter,
} from "@/features/pages/api"
import { captureSheet, SHEET_WIDTH } from "@/features/pages/export"
import { filterSummary } from "@/features/pages/format"
import { PageGrid } from "@/features/pages/page-grid"
import { toErrorMessage } from "@/lib/ipc-error"

const CHART_VIEWS = ["bar", "line", "area", "stacked", "scatter"]
const CHART_WAIT_MS = 3000
const CHART_POLL_MS = 50
const SETTLE_MS = 150

const pause = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

async function chartsDrawn(sheet: HTMLElement, count: number) {
  const deadline = performance.now() + CHART_WAIT_MS
  while (performance.now() < deadline) {
    if (sheet.querySelectorAll(".recharts-surface").length >= count) break
    await pause(CHART_POLL_MS)
  }
  await pause(SETTLE_MS)
}

type ExportSheetProps = {
  page: Page
  results: Record<string, BlockResult>
  clicked: PageFilter[]
  through?: string
  format: ExportFormat
  onSaved: (path: string | null) => void
  onFailed: (message: string) => void
}

// A fixed light sheet, so an export looks the same at any window size or theme.
export function ExportSheet({
  page,
  results,
  clicked,
  through,
  format,
  onSaved,
  onFailed,
}: ExportSheetProps) {
  const sheet = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onSaved, onFailed })
  const details = [
    through,
    ...[...page.filters, ...clicked].map(filterSummary),
  ].filter(Boolean)
  const chartCount = page.rows
    .flatMap((row) => row.blocks)
    .filter(
      ({ id, view }) =>
        CHART_VIEWS.includes(view ?? "") && results[id]?.result?.rows.length
    ).length

  useEffect(() => {
    callbacks.current = { onSaved, onFailed }
  }, [onFailed, onSaved])

  useEffect(() => {
    let isCancelled = false
    async function run(element: HTMLElement) {
      await chartsDrawn(element, chartCount)
      if (isCancelled) return
      const images = await captureSheet(element, format)
      if (isCancelled) return
      callbacks.current.onSaved(await exportPage(page.title, format, images))
    }
    if (sheet.current) {
      run(sheet.current).catch((failure: unknown) =>
        callbacks.current.onFailed(toErrorMessage(failure))
      )
    }
    return () => {
      isCancelled = true
    }
  }, [chartCount, format, page.title])

  return createPortal(
    <div
      inert
      aria-hidden="true"
      className="pointer-events-none fixed top-0 -left-[9999rem]"
    >
      <div
        ref={sheet}
        data-testid="export-sheet"
        style={{ width: SHEET_WIDTH }}
        className="light flex flex-col gap-3 bg-background p-3 pt-6 font-sans text-sm text-foreground"
      >
        <div className="flex flex-col gap-0.5 px-3">
          <h1 className="text-2xl font-medium">{page.title}</h1>
          {details.length > 0 && (
            <p className="text-muted-foreground">{details.join(" · ")}</p>
          )}
        </div>
        <PageGrid page={page} results={results} isEditing={false} isExporting />
      </div>
    </div>,
    document.body
  )
}
