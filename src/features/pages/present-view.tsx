import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { Button } from "@/components/ui/button"
import { setFullscreen, type ValueSelector } from "@/features/pages/api"
import { FilterBar } from "@/features/pages/filter-bar"
import { PageGrid } from "@/features/pages/page-grid"
import type { usePage } from "@/features/pages/use-page"

const DESIGN_WIDTH = 1100
const LARGEST_ZOOM = 2
const OPEN_POPUP =
  '[data-slot="dropdown-menu-content"], [data-slot="popover-content"], [data-slot="dialog-content"]'

function zoomFor(width: number) {
  return Math.min(Math.max(width / DESIGN_WIDTH, 1), LARGEST_ZOOM)
}

type PresentViewProps = {
  project: string
  pages: ReturnType<typeof usePage>
  through?: string
  selectorFor: (column: string) => ValueSelector | undefined
  onExit: () => void
}

export function PresentView({
  project,
  pages,
  through,
  selectorFor,
  onExit,
}: PresentViewProps) {
  const { page, results, reach, clicked, changeFilter, setClickedFilters } =
    pages
  const [zoom, setZoom] = useState(() => zoomFor(window.innerWidth))
  const stage = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const app = document.getElementById("root")
    if (app) app.inert = true
    stage.current?.focus()
    const report = (failure: unknown) =>
      console.error("Could not change full screen", failure)
    setFullscreen(true).catch(report)
    return () => {
      if (app) app.inert = false
      setFullscreen(false).catch(report)
    }
  }, [])

  useEffect(() => {
    const resize = () => setZoom(zoomFor(window.innerWidth))
    window.addEventListener("resize", resize)
    return () => window.removeEventListener("resize", resize)
  }, [])

  useEffect(() => {
    function exitOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !document.querySelector(OPEN_POPUP))
        onExit()
    }
    window.addEventListener("keydown", exitOnEscape)
    return () => window.removeEventListener("keydown", exitOnEscape)
  }, [onExit])

  if (!page) return null

  return createPortal(
    <div
      ref={stage}
      role="dialog"
      aria-label={`Presenting ${page.title}`}
      tabIndex={-1}
      className="fixed inset-0 z-40 overflow-y-auto bg-background outline-none"
    >
      <Button
        variant="ghost"
        size="sm"
        className="fixed top-2 right-2 z-10 font-normal text-muted-foreground"
        onClick={onExit}
      >
        <HugeiconsIcon
          icon={Cancel01Icon}
          strokeWidth={1.5}
          data-icon="inline-start"
        />
        Exit
      </Button>
      <div style={{ zoom }} className="flex flex-col gap-2 pt-3">
        <div className="flex flex-col gap-0.5 px-3">
          <h1 className="text-2xl font-medium">{page.title}</h1>
          {through && <p className="text-xs text-subtle">{through}</p>}
        </div>
        <FilterBar
          project={project}
          filters={page.filters}
          clicked={clicked}
          reach={reach}
          isEditing={false}
          onChange={changeFilter}
          onAdd={() => {}}
          onRemove={() => {}}
          onClearClicked={(id) =>
            setClickedFilters(clicked.filter((item) => item.id !== id))
          }
        />
        <PageGrid
          page={page}
          results={results}
          isEditing={false}
          selectorFor={selectorFor}
        />
      </div>
    </div>,
    document.body
  )
}
