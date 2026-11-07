import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core"
import { useState } from "react"

import type { Block, BlockResult, Grain, Page } from "@/features/pages/api"
import { BlockView } from "@/features/pages/block-view"
import { MAX_BLOCKS_IN_ROW, type DropTarget } from "@/features/pages/layout"
import { cn } from "@/lib/utils"

const DRAG_START_DISTANCE = 4

const nearestToPointer: CollisionDetection = ({
  droppableContainers,
  droppableRects,
  pointerCoordinates,
}) => {
  if (!pointerCoordinates) return []
  const { x, y } = pointerCoordinates
  return droppableContainers
    .flatMap((container) => {
      const rect = droppableRects.get(container.id)
      if (!rect) return []
      const across = Math.max(rect.left - x, 0, x - rect.right)
      const down = Math.max(rect.top - y, 0, y - rect.bottom)
      return [
        {
          id: container.id,
          data: {
            droppableContainer: container,
            value: Math.hypot(across, down),
          },
        },
      ]
    })
    .sort((first, second) => first.data.value - second.data.value)
    .slice(0, 1)
}

function DropGap({
  target,
  isVertical,
  isShown,
  isDisabled,
}: {
  target: DropTarget
  isVertical?: boolean
  isShown: boolean
  isDisabled?: boolean
}) {
  const id =
    target.kind === "new-row"
      ? `new-${target.index}`
      : `in-${target.rowId}-${target.index}`
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: target,
    disabled: isDisabled,
  })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "shrink-0 rounded-full transition-colors",
        isVertical
          ? "w-2 self-stretch @max-[440px]/page:h-2 @max-[440px]/page:w-full"
          : "h-2 w-full",
        isShown && !isDisabled && "bg-primary/10",
        isOver && "bg-primary"
      )}
    />
  )
}

function DraggableBlock({
  block,
  ...props
}: Omit<
  React.ComponentProps<typeof BlockView>,
  "dragAttributes" | "dragListeners"
>) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: block.id })
  return (
    <div
      ref={setNodeRef}
      className={cn("min-w-0", isDragging && "relative z-10 opacity-80")}
      style={{
        flexGrow: block.weight,
        flexBasis: 0,
        transform: transform
          ? `translate(${transform.x}px, ${transform.y}px)`
          : undefined,
      }}
    >
      <BlockView
        block={block}
        dragAttributes={attributes}
        dragListeners={listeners}
        {...props}
      />
    </div>
  )
}

type PageGridProps = {
  page: Page
  results: Record<string, BlockResult>
  isEditing: boolean
  selectedId?: string
  onMove: (id: string, target: DropTarget) => void
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onTextChange: (id: string, text: string) => void
  onSelectValue?: (column: string, value: string, grain?: Grain) => void
}

export function PageGrid({
  page,
  results,
  isEditing,
  selectedId,
  onMove,
  onSelect,
  onRemove,
  onTextChange,
  onSelectValue,
}: PageGridProps) {
  const [isDragging, setIsDragging] = useState(false)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: DRAG_START_DISTANCE },
    })
  )

  function finish({ active, over }: DragEndEvent) {
    setIsDragging(false)
    const target = over?.data.current as DropTarget | undefined
    if (target) onMove(String(active.id), target)
  }

  const blockProps = (block: Block) => ({
    block,
    outcome: results[block.id],
    isEditing,
    isSelected: selectedId === block.id,
    onSelect: () => onSelect(block.id),
    onRemove: () => onRemove(block.id),
    onTextChange: (text: string) => onTextChange(block.id, text),
    onSelectValue,
  })

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={nearestToPointer}
      autoScroll={{ threshold: { x: 0, y: 0.2 } }}
      onDragStart={() => setIsDragging(true)}
      onDragCancel={() => setIsDragging(false)}
      onDragEnd={finish}
    >
      <div className="@container/page shrink-0 px-3 pb-3">
        <div className={cn("flex flex-col", isEditing ? "-my-2" : "gap-2")}>
          {page.rows.map((row, rowIndex) => {
            const isFull = row.blocks.length >= MAX_BLOCKS_IN_ROW
            return (
              <div key={row.id} className="contents">
                {isEditing && (
                  <DropGap
                    isShown={isDragging}
                    target={{ kind: "new-row", index: rowIndex }}
                  />
                )}
                <div
                  data-row={row.id}
                  className={cn(
                    "flex @max-[440px]/page:flex-col",
                    isEditing ? "-mx-2" : "gap-2"
                  )}
                >
                  {row.blocks.map((block, blockIndex) => (
                    <div key={block.id} className="contents">
                      {isEditing && (
                        <DropGap
                          isVertical
                          isShown={isDragging}
                          isDisabled={isFull}
                          target={{
                            kind: "in-row",
                            rowId: row.id,
                            index: blockIndex,
                          }}
                        />
                      )}
                      <DraggableBlock {...blockProps(block)} />
                    </div>
                  ))}
                  {isEditing && (
                    <DropGap
                      isVertical
                      isShown={isDragging}
                      isDisabled={isFull}
                      target={{
                        kind: "in-row",
                        rowId: row.id,
                        index: row.blocks.length,
                      }}
                    />
                  )}
                </div>
              </div>
            )
          })}
          {isEditing && (
            <DropGap
              isShown={isDragging}
              target={{ kind: "new-row", index: page.rows.length }}
            />
          )}
        </div>
      </div>
    </DndContext>
  )
}
