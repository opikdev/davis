import { useCallback, useEffect, useRef, useState } from "react"

import { readRows, type Row, type TableSource } from "@/features/data/api"
import { toErrorMessage } from "@/lib/ipc-error"

export const PAGE_SIZE = 200
const SCROLL_SETTLE_MS = 60
const MAX_KEPT_PAGES = 40

export function useRowPages(
  source: TableSource,
  firstRow: number,
  lastRow: number
) {
  const [pages, setPages] = useState<ReadonlyMap<number, Row[]>>(new Map())
  const [error, setError] = useState<string>()
  const requested = useRef(new Set<number>())
  const firstPage = Math.floor(firstRow / PAGE_SIZE)
  const lastPage = Math.floor(lastRow / PAGE_SIZE)

  const loadPage = useCallback(
    async (page: number) => {
      requested.current.add(page)
      try {
        const rows = await readRows(source, page * PAGE_SIZE, PAGE_SIZE)
        setPages((known) => {
          const next = new Map(known).set(page, rows)
          for (const kept of next.keys()) {
            if (next.size <= MAX_KEPT_PAGES) break
            next.delete(kept)
            requested.current.delete(kept)
          }
          return next
        })
      } catch (failure) {
        requested.current.delete(page)
        setError(toErrorMessage(failure))
      }
    },
    [source]
  )

  useEffect(() => {
    const timer = setTimeout(() => {
      for (let page = firstPage; page <= lastPage; page += 1) {
        if (!requested.current.has(page)) void loadPage(page)
      }
    }, SCROLL_SETTLE_MS)

    return () => clearTimeout(timer)
  }, [firstPage, lastPage, loadPage, error])

  const retry = useCallback(() => setError(undefined), [])

  const rowAt = useCallback(
    (index: number): Row | undefined =>
      pages.get(Math.floor(index / PAGE_SIZE))?.[index % PAGE_SIZE],
    [pages]
  )

  return { rowAt, error, retry }
}
