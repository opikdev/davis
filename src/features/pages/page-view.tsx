import {
  Add01Icon,
  ArrowTurnBackwardIcon,
  ArrowTurnForwardIcon,
  ChartBarLineIcon,
  Note01Icon,
  Table01Icon,
  Tick02Icon,
  PencilEdit02Icon,
  HashtagIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { useEffect } from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  buildBlockQuery,
  projectColumns,
  type Block,
  type Grain,
} from "@/features/pages/api"
import { defaultSpec } from "@/features/pages/block-settings"
import { clickedFilter } from "@/features/pages/clicked-filter"
import { FilterBar } from "@/features/pages/filter-bar"
import { PageGrid } from "@/features/pages/page-grid"
import { StartingPoints } from "@/features/pages/starting-points"
import type { usePage } from "@/features/pages/use-page"

const NEW_BLOCKS: {
  label: string
  icon: IconSvgElement
  view: Block["view"]
}[] = [
  { label: "Chart", icon: ChartBarLineIcon, view: "bar" },
  { label: "Number", icon: HashtagIcon, view: "number" },
  { label: "Table", icon: Table01Icon, view: "table" },
]

type PageViewProps = {
  project: string
  pages: ReturnType<typeof usePage>
  hasData: boolean
  isLocked: boolean
}

export function PageView({ project, pages, hasData, isLocked }: PageViewProps) {
  const { page, results, reach, error, isEditing, selectedId, clicked } = pages
  const { undo, redo } = pages
  const canEdit = isEditing && !isLocked

  useEffect(() => {
    if (!canEdit) return
    function onKey(event: KeyboardEvent) {
      const isField = (event.target as HTMLElement).closest("input, textarea")
      if (!(event.metaKey || event.ctrlKey) || event.key !== "z" || isField) {
        return
      }
      event.preventDefault()
      void (event.shiftKey ? redo() : undo())
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [canEdit, redo, undo])

  if (!page) return null

  async function addFigure(view: Block["view"], label: string) {
    const spec = defaultSpec(await projectColumns(project))
    if (!spec) return
    const planned = view === "number" ? { ...spec, by: null } : spec
    const built = await buildBlockQuery(project, planned)
    await pages.add({
      kind: "figure",
      title: label,
      view,
      spec: planned,
      sql: built.sql,
      trendSql: built.trendSql,
      xColumn: built.xColumn,
      yColumn: built.yColumn,
    })
  }

  async function selectValue(column: string, value: string, grain?: Grain) {
    const tables = await projectColumns(project)
    const filter = clickedFilter(tables, column, value, grain)
    if (!filter) return
    const others = clicked.filter((item) => item.id !== filter.id)
    const isSame = clicked.some(
      (item) => item.id === filter.id && item.values[0] === value
    )
    pages.setClickedFilters(isSame ? others : [...others, filter])
  }

  const isEmpty = page.rows.length === 0

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto">
      <div className="flex shrink-0 items-center gap-1.5 px-3 pt-3">
        <h1
          className={
            canEdit ? "sr-only" : "min-w-0 flex-1 truncate text-lg font-medium"
          }
        >
          {page.title}
        </h1>
        {canEdit && (
          <Input
            key={page.title}
            aria-label="Page title"
            defaultValue={page.title}
            onBlur={(event) => pages.rename(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur()
            }}
            className="h-7 flex-1 border-0 bg-transparent px-0 text-lg font-medium shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
        )}
        {canEdit && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Undo"
              disabled={!pages.canUndo}
              onClick={() => void undo()}
            >
              <HugeiconsIcon icon={ArrowTurnBackwardIcon} strokeWidth={1.5} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Redo"
              disabled={!pages.canRedo}
              onClick={() => void redo()}
            >
              <HugeiconsIcon icon={ArrowTurnForwardIcon} strokeWidth={1.5} />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="outline" size="sm" />}
              >
                <HugeiconsIcon
                  icon={Add01Icon}
                  strokeWidth={1.5}
                  data-icon="inline-start"
                />
                Add block
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-36">
                {NEW_BLOCKS.map(({ label, icon, view }) => (
                  <DropdownMenuItem
                    key={label}
                    disabled={!hasData}
                    onClick={() => void addFigure(view, label)}
                  >
                    <HugeiconsIcon icon={icon} strokeWidth={1.5} />
                    {label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem
                  onClick={() => void pages.add({ kind: "text", text: "" })}
                >
                  <HugeiconsIcon icon={Note01Icon} strokeWidth={1.5} />
                  Text
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
        <Button
          variant={canEdit ? "default" : "outline"}
          size="sm"
          disabled={isLocked}
          onClick={pages.toggleEditing}
        >
          <HugeiconsIcon
            icon={canEdit ? Tick02Icon : PencilEdit02Icon}
            strokeWidth={1.5}
            data-icon="inline-start"
          />
          {canEdit ? "Done" : "Edit"}
        </Button>
      </div>
      <FilterBar
        project={project}
        filters={page.filters}
        clicked={clicked}
        reach={reach}
        isEditing={canEdit}
        onChange={pages.changeFilter}
        onAdd={pages.addFilter}
        onRemove={pages.removeFilter}
        onClearClicked={(id) =>
          pages.setClickedFilters(clicked.filter((item) => item.id !== id))
        }
      />
      {error && (
        <p role="alert" className="px-3 text-destructive select-text">
          {error}
        </p>
      )}
      {isEmpty && !canEdit ? (
        <StartingPoints
          hasData={hasData}
          onDraft={(kind) => void pages.draft(kind)}
          onStartBlank={pages.toggleEditing}
        />
      ) : (
        <PageGrid
          page={page}
          results={results}
          isEditing={canEdit}
          selectedId={selectedId}
          onMove={pages.move}
          onSelect={pages.select}
          onRemove={pages.removeBlock}
          onTextChange={(id, text) => pages.updateBlock(id, { text })}
          onSelectValue={(column, value, grain) =>
            void selectValue(column, value, grain)
          }
        />
      )}
    </div>
  )
}
