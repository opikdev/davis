import { useCallback, useRef, useState } from "react"

import {
  addBlock,
  deletePage,
  readPage,
  runPage,
  savePage,
  type Block,
  type BlockResult,
  type Page,
} from "@/features/pages/api"
import { toErrorMessage } from "@/lib/ipc-error"

const NEW_PAGE_TITLE = "Untitled page"

export function usePage(
  project: string | undefined,
  onSaved: (project: string) => void
) {
  const [page, setPage] = useState<Page>()
  const [results, setResults] = useState<Record<string, BlockResult>>({})
  const [reach, setReach] = useState<Record<string, string[]>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string>()
  const latestRun = useRef(0)
  const created = useRef<string>(undefined)

  const run = useCallback(async (path: string, next: Page) => {
    latestRun.current += 1
    const thisRun = latestRun.current
    setIsLoading(true)
    try {
      const finished = await runPage(path, next)
      if (thisRun !== latestRun.current) return
      setResults(
        Object.fromEntries(finished.blocks.map((item) => [item.id, item]))
      )
      setReach(
        Object.fromEntries(finished.filters.map(({ id, files }) => [id, files]))
      )
      setError(undefined)
    } catch (failure) {
      if (thisRun === latestRun.current) setError(toErrorMessage(failure))
    } finally {
      if (thisRun === latestRun.current) setIsLoading(false)
    }
  }, [])

  const open = useCallback(
    async (id: string) => {
      if (!project) return
      const next = await readPage(project, id)
      setPage(next)
      setResults({})
      await run(project, next)
    },
    [project, run]
  )

  const reload = useCallback(async () => {
    if (!project || !page) return
    const next = await readPage(project, page.id)
    setPage(next)
    onSaved(project)
    await run(project, next)
  }, [onSaved, page, project, run])

  const close = useCallback(() => {
    latestRun.current += 1
    setPage(undefined)
    setResults({})
    setError(undefined)
    setIsLoading(false)
  }, [])

  const commit = useCallback(
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

  const create = useCallback(async () => {
    if (!project) return
    const next: Page = {
      id: crypto.randomUUID(),
      title: NEW_PAGE_TITLE,
      updatedAt: Date.now(),
      blocks: [],
    }
    await savePage(project, next)
    created.current = next.id
    onSaved(project)
    setPage(next)
    setResults({})
    return next
  }, [onSaved, project])

  const rename = useCallback(
    (title: string) => {
      if (page && title.trim() && title !== page.title) {
        void commit({ ...page, title: title.trim() })
      }
    },
    [commit, page]
  )

  const arrange = useCallback(
    (positions: Pick<Block, "x" | "y" | "w" | "h">[], ids: string[]) => {
      if (!page) return
      const blocks = page.blocks.map((block) => {
        const place = positions[ids.indexOf(block.id)]
        return place ? { ...block, ...place } : block
      })
      const isSame = blocks.every(
        (block, index) =>
          block.x === page.blocks[index].x &&
          block.y === page.blocks[index].y &&
          block.w === page.blocks[index].w &&
          block.h === page.blocks[index].h
      )
      if (!isSame) void commit({ ...page, blocks })
    },
    [commit, page]
  )

  const removeBlock = useCallback(
    async (id: string) => {
      if (!page || !project) return
      const removed = page.blocks.find((block) => block.id === id)
      const next = await commit({
        ...page,
        blocks: page.blocks.filter((block) => block.id !== id),
      })
      if (next && removed?.kind === "filter") await run(project, next)
    },
    [commit, page, project, run]
  )

  const changeText = useCallback(
    (id: string, text: string) => {
      if (!page) return
      void commit({
        ...page,
        blocks: page.blocks.map((block) =>
          block.id === id ? { ...block, text } : block
        ),
      })
    },
    [commit, page]
  )

  const changeFilter = useCallback(
    async (id: string, values: string[]) => {
      if (!page || !project) return
      const next = await commit({
        ...page,
        blocks: page.blocks.map((block) =>
          block.id === id ? { ...block, values } : block
        ),
      })
      if (next) await run(project, next)
    },
    [commit, page, project, run]
  )

  const add = useCallback(
    async (block: Partial<Block>) => {
      if (!page || !project) return
      const next = await addBlock(project, page.id, block, Date.now())
      setPage(next)
      onSaved(project)
      await run(project, next)
    },
    [onSaved, page, project, run]
  )

  // Pinning follows straight after opening a Page, before state has caught up.
  const addTo = useCallback(
    async (pageId: string | undefined, block: Partial<Block>) => {
      const target = pageId ?? created.current
      if (!project || !target) return
      const next = await addBlock(project, target, block, Date.now())
      setPage(next)
      onSaved(project)
      await run(project, next)
    },
    [onSaved, project, run]
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

  return {
    page,
    results,
    reach,
    isLoading,
    error,
    open,
    reload,
    close,
    create,
    rename,
    arrange,
    removeBlock,
    changeText,
    changeFilter,
    add,
    addTo,
    remove,
  }
}
