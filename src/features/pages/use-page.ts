import { useCallback, useRef, useState } from "react"

import {
  addBlock,
  deletePage,
  draftPage,
  readPage,
  runPage,
  savePage,
  type Block,
  type BlockResult,
  type DraftKind,
  type Page,
  type PageFilter,
} from "@/features/pages/api"
import {
  changeBlock,
  moveBlock,
  removeBlock as withoutBlock,
  type DropTarget,
} from "@/features/pages/layout"
import { toErrorMessage } from "@/lib/ipc-error"

const NEW_PAGE_TITLE = "Untitled page"
const MAX_UNDO = 50

export function usePage(
  project: string | undefined,
  onSaved: (project: string) => void
) {
  const [page, setPage] = useState<Page>()
  const [results, setResults] = useState<Record<string, BlockResult>>({})
  const [reach, setReach] = useState<Record<string, string[]>>({})
  const [dataThrough, setDataThrough] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [isEditing, setIsEditing] = useState(false)
  const [selectedId, setSelectedId] = useState<string>()
  const [clicked, setClicked] = useState<PageFilter[]>([])
  const [history, setHistory] = useState<{ past: Page[]; future: Page[] }>({
    past: [],
    future: [],
  })
  const latestRun = useRef(0)
  const created = useRef<string>(undefined)

  const run = useCallback(
    async (path: string, next: Page, extra: PageFilter[]) => {
      latestRun.current += 1
      const thisRun = latestRun.current
      setIsLoading(true)
      try {
        const finished = await runPage(path, {
          ...next,
          filters: [...next.filters, ...extra],
        })
        if (thisRun !== latestRun.current) return
        setResults(
          Object.fromEntries(finished.blocks.map((item) => [item.id, item]))
        )
        setReach(
          Object.fromEntries(
            finished.filters.map(({ id, files }) => [id, files])
          )
        )
        setDataThrough(finished.dataThrough)
        setError(undefined)
      } catch (failure) {
        if (thisRun === latestRun.current) setError(toErrorMessage(failure))
      } finally {
        if (thisRun === latestRun.current) setIsLoading(false)
      }
    },
    []
  )

  const remember = useCallback((previous: Page) => {
    setHistory(({ past }) => ({
      past: [...past, previous].slice(-MAX_UNDO),
      future: [],
    }))
  }, [])

  const show = useCallback(
    async (next: Page) => {
      if (!project) return
      setPage(next)
      setClicked([])
      await run(project, next, [])
    },
    [project, run]
  )

  const open = useCallback(
    async (id: string) => {
      if (!project) return
      const next = await readPage(project, id)
      setResults({})
      setIsEditing(false)
      setSelectedId(undefined)
      setHistory({ past: [], future: [] })
      await show(next)
    },
    [project, show]
  )

  const reload = useCallback(async () => {
    if (!project || !page) return
    const next = await readPage(project, page.id)
    remember(page)
    onSaved(project)
    await show(next)
  }, [onSaved, page, project, remember, show])

  const close = useCallback(() => {
    latestRun.current += 1
    setPage(undefined)
    setResults({})
    setError(undefined)
    setIsLoading(false)
    setIsEditing(false)
    setSelectedId(undefined)
    setClicked([])
    setHistory({ past: [], future: [] })
  }, [])

  const store = useCallback(
    async (next: Page) => {
      if (!project) return
      const stamped = { ...next, updatedAt: Date.now() }
      setPage(stamped)
      try {
        await savePage(project, stamped)
        onSaved(project)
      } catch (failure) {
        setError(toErrorMessage(failure))
      }
      return stamped
    },
    [onSaved, project]
  )

  const commit = useCallback(
    async (next: Page, shouldRun = false) => {
      if (!page || !project) return
      remember(page)
      const stamped = await store(next)
      if (stamped && shouldRun) await run(project, stamped, clicked)
    },
    [clicked, page, project, remember, run, store]
  )

  const undo = useCallback(async () => {
    const previous = history.past.at(-1)
    if (!previous || !page || !project) return
    setHistory(({ past, future }) => ({
      past: past.slice(0, -1),
      future: [page, ...future],
    }))
    const stamped = await store(previous)
    if (stamped) await run(project, stamped, clicked)
  }, [clicked, history.past, page, project, run, store])

  const redo = useCallback(async () => {
    const [next] = history.future
    if (!next || !page || !project) return
    setHistory(({ past, future }) => ({
      past: [...past, page],
      future: future.slice(1),
    }))
    const stamped = await store(next)
    if (stamped) await run(project, stamped, clicked)
  }, [clicked, history.future, page, project, run, store])

  const create = useCallback(async () => {
    if (!project) return
    const next: Page = {
      id: crypto.randomUUID(),
      title: NEW_PAGE_TITLE,
      updatedAt: Date.now(),
      rows: [],
      filters: [],
    }
    await savePage(project, next)
    created.current = next.id
    onSaved(project)
    setPage(next)
    setResults({})
    setClicked([])
    setHistory({ past: [], future: [] })
    setSelectedId(undefined)
    setIsEditing(false)
    return next
  }, [onSaved, project])

  const draft = useCallback(
    async (kind: DraftKind) => {
      if (!project || !page) return
      remember(page)
      try {
        const next = await draftPage(project, page.id, kind, Date.now())
        onSaved(project)
        await show(next)
      } catch (failure) {
        setError(toErrorMessage(failure))
      }
    },
    [onSaved, page, project, remember, show]
  )

  const rename = useCallback(
    (title: string) => {
      if (page && title.trim() && title !== page.title) {
        void commit({ ...page, title: title.trim() })
      }
    },
    [commit, page]
  )

  const move = useCallback(
    (id: string, target: DropTarget) => {
      if (!page) return
      const rows = moveBlock(page.rows, id, target)
      if (rows !== page.rows) void commit({ ...page, rows })
    },
    [commit, page]
  )

  const updateBlock = useCallback(
    (id: string, change: Partial<Block>, shouldRun = false) => {
      if (!page) return
      void commit(
        { ...page, rows: changeBlock(page.rows, id, change) },
        shouldRun
      )
    },
    [commit, page]
  )

  const removeBlock = useCallback(
    (id: string) => {
      if (!page) return
      if (selectedId === id) setSelectedId(undefined)
      void commit({ ...page, rows: withoutBlock(page.rows, id) })
    },
    [commit, page, selectedId]
  )

  const add = useCallback(
    async (block: Partial<Block>) => {
      if (!page || !project) return
      remember(page)
      const next = await addBlock(project, page.id, block, Date.now())
      setPage(next)
      onSaved(project)
      setSelectedId(next.rows.at(-1)?.blocks.at(-1)?.id)
      await run(project, next, clicked)
    },
    [clicked, onSaved, page, project, remember, run]
  )

  const addTo = useCallback(
    async (pageId: string | undefined, block: Partial<Block>) => {
      const target = pageId ?? created.current
      if (!project || !target) return
      const next = await addBlock(project, target, block, Date.now())
      setPage(next)
      onSaved(project)
      await run(project, next, [])
    },
    [onSaved, project, run]
  )

  const changeFilter = useCallback(
    (id: string, change: Partial<PageFilter>) => {
      if (!page) return
      void commit(
        {
          ...page,
          filters: page.filters.map((filter) =>
            filter.id === id ? { ...filter, ...change } : filter
          ),
        },
        true
      )
    },
    [commit, page]
  )

  const addFilter = useCallback(
    (filter: PageFilter) => {
      if (!page) return
      void commit({ ...page, filters: [...page.filters, filter] })
    },
    [commit, page]
  )

  const removeFilter = useCallback(
    (id: string) => {
      if (!page) return
      void commit(
        {
          ...page,
          filters: page.filters.filter((filter) => filter.id !== id),
        },
        true
      )
    },
    [commit, page]
  )

  const setClickedFilters = useCallback(
    (next: PageFilter[]) => {
      if (!page || !project) return
      setClicked(next)
      void run(project, page, next)
    },
    [page, project, run]
  )

  const remove = useCallback(
    async (id: string) => {
      if (!project) return
      await deletePage(project, id)
      if (page?.id === id) close()
      onSaved(project)
    },
    [close, onSaved, page?.id, project]
  )

  const toggleEditing = useCallback(() => {
    setIsEditing((current) => !current)
    setSelectedId(undefined)
  }, [])

  return {
    page,
    results,
    reach,
    dataThrough,
    isLoading,
    error,
    isEditing,
    selectedId,
    clicked,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    open,
    reload,
    close,
    create,
    draft,
    rename,
    move,
    updateBlock,
    removeBlock,
    add,
    addTo,
    changeFilter,
    addFilter,
    removeFilter,
    setClickedFilters,
    remove,
    undo,
    redo,
    toggleEditing,
    select: setSelectedId,
  }
}
