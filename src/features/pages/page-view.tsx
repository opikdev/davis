import {
  Add01Icon,
  DashboardSquare01Icon,
  FilterIcon,
  Note01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useState } from "react"
import ReactGridLayout, {
  useContainerWidth,
  verticalCompactor,
  type Layout,
} from "react-grid-layout"

import "react-grid-layout/css/styles.css"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { AddFilterDialog } from "@/features/pages/add-filter-dialog"
import { BlockView } from "@/features/pages/block-view"
import type { Page } from "@/features/pages/api"
import type { usePage } from "@/features/pages/use-page"

const GRID_COLUMNS = 12
const ROW_HEIGHT = 24
const GRID_GAP = 8
const MIN_WIDTH = 2
const MIN_HEIGHT = 2
const FILTER_SIZE = { w: 3, h: 3 }
const TEXT_SIZE = { w: 6, h: 3 }

type PageViewProps = {
  project: string
  pages: ReturnType<typeof usePage>
  isLocked: boolean
}

function EmptyPage() {
  return (
    <Empty className="border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={DashboardSquare01Icon} strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>
          <h2>Nothing on this Page yet</h2>
        </EmptyTitle>
        <EmptyDescription>
          Ask the AI to build it, or add an answer from any chat.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

// The width hook attaches when it mounts, so it has to mount with the grid element.
function PageGrid({
  project,
  pages,
  isLocked,
  page,
}: PageViewProps & { page: Page }) {
  const { results, reach } = pages
  const { width, containerRef, mounted } = useContainerWidth()

  const layout: Layout = page.blocks.map(({ id, x, y, w, h }) => ({
    i: id,
    x,
    y,
    w,
    h,
    minW: MIN_WIDTH,
    minH: MIN_HEIGHT,
  }))

  function saveLayout(next: Layout) {
    pages.arrange(
      next.map(({ x, y, w, h }) => ({ x, y, w, h })),
      next.map(({ i }) => i)
    )
  }

  return (
    <div
      ref={containerRef}
      className="w-full min-w-0 shrink-0 overflow-hidden pb-3"
    >
      {mounted && (
        <ReactGridLayout
          width={width}
          layout={layout}
          gridConfig={{
            cols: GRID_COLUMNS,
            rowHeight: ROW_HEIGHT,
            margin: [GRID_GAP, GRID_GAP],
          }}
          dragConfig={{
            enabled: !isLocked,
            handle: ".block-handle",
            cancel: ".block-action",
          }}
          resizeConfig={{ enabled: !isLocked }}
          compactor={verticalCompactor}
          onLayoutChange={saveLayout}
        >
          {page.blocks.map((block) => (
            <div key={block.id}>
              <BlockView
                block={block}
                outcome={results[block.id]}
                reach={reach[block.id]}
                project={project}
                isLocked={isLocked}
                onRemove={() => void pages.removeBlock(block.id)}
                onTextChange={(text) => pages.changeText(block.id, text)}
                onFilterChange={(values) =>
                  void pages.changeFilter(block.id, values)
                }
              />
            </div>
          ))}
        </ReactGridLayout>
      )}
    </div>
  )
}

export function PageView({ project, pages, isLocked }: PageViewProps) {
  const { page, error } = pages
  const [isChoosingFilter, setIsChoosingFilter] = useState(false)
  if (!page) return null

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
      <div className="flex shrink-0 items-center gap-2 px-3 pt-3 pb-1">
        <h1 className="sr-only">{page.title}</h1>
        <Input
          key={page.title}
          aria-label="Page title"
          defaultValue={page.title}
          readOnly={isLocked}
          onBlur={(event) => pages.rename(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur()
          }}
          className="h-8 flex-1 border-0 bg-transparent px-1 text-lg font-medium shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={isLocked}
            render={<Button variant="outline" size="sm" />}
          >
            <HugeiconsIcon
              icon={Add01Icon}
              strokeWidth={1.5}
              data-icon="inline-start"
            />
            Add
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-36">
            <DropdownMenuItem
              onClick={() => void pages.add({ kind: "text", ...TEXT_SIZE })}
            >
              <HugeiconsIcon icon={Note01Icon} strokeWidth={1.5} />
              Note
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setIsChoosingFilter(true)}>
              <HugeiconsIcon icon={FilterIcon} strokeWidth={1.5} />
              Filter
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {error && (
        <p role="alert" className="px-4 text-destructive select-text">
          {error}
        </p>
      )}
      {page.blocks.length === 0 ? (
        <EmptyPage />
      ) : (
        <PageGrid
          project={project}
          pages={pages}
          isLocked={isLocked}
          page={page}
        />
      )}
      {isChoosingFilter && (
        <AddFilterDialog
          project={project}
          onClose={() => setIsChoosingFilter(false)}
          onChoose={(table, column) => {
            setIsChoosingFilter(false)
            void pages.add({
              kind: "filter",
              title: column,
              table,
              column,
              ...FILTER_SIZE,
            })
          }}
        />
      )}
    </div>
  )
}
