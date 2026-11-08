import {
  ArrowRight01Icon,
  Basketball01Icon,
  ComputerIcon,
  FlashIcon,
  Globe02Icon,
  Leaf01Icon,
  Route01Icon,
  ShoppingBag01Icon,
  Sun03Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { DatabaseIcon, type DatabaseKind } from "@/features/connections"
import {
  libraryDatasets,
  type Category,
  type Dataset,
} from "@/features/library/api"
import { toErrorMessage } from "@/lib/ipc-error"
import { cn } from "@/lib/utils"

const NEEDS_PROJECT = "Open or create a project first, then connect a database."
const SHOWN_DATASETS = 3

const CONNECTIONS: { kind: DatabaseKind; color: string; name: string }[] = [
  { kind: "postgres", color: "#336791", name: "PostgreSQL" },
  { kind: "mysql", color: "#00758f", name: "MySQL" },
]

const CATEGORY_ICONS: Record<Category, IconSvgElement> = {
  business: ShoppingBag01Icon,
  world: Globe02Icon,
  climate: Sun03Icon,
  energy: FlashIcon,
  transport: Route01Icon,
  nature: Leaf01Icon,
  technology: ComputerIcon,
  sports: Basketball01Icon,
}

function IconTile({ icon }: { icon: IconSvgElement }) {
  return (
    <span className="grid size-4.5 shrink-0 place-items-center rounded-sm bg-muted">
      <HugeiconsIcon icon={icon} strokeWidth={1.5} className="size-3" />
    </span>
  )
}

function SourceRow({
  tile,
  name,
  detail,
  onClick,
}: {
  tile: React.ReactNode
  name: string
  detail?: string
  onClick: () => void
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      className="h-7 w-full justify-start gap-2 px-1.5 font-normal"
    >
      {tile}
      {name}
      {detail && (
        <span className="ml-auto text-xs text-subtle tabular-nums">
          {detail}
        </span>
      )}
    </Button>
  )
}

function SourceCard({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col rounded-xl border bg-background p-1">
      <h2 className="px-1.5 pt-1 pb-0.5 text-xs text-subtle">{title}</h2>
      {children}
    </section>
  )
}

type HomeProps = {
  isDragging: boolean
  projectName?: string
  openingName?: string
  error?: string
  onBrowse: () => void
  onConnect: (kind: DatabaseKind) => void
  onOpenDataset: (id: string) => void
  onOpenLibrary: () => void
}

export function Home({
  isDragging,
  projectName,
  openingName,
  error,
  onBrowse,
  onConnect,
  onOpenDataset,
  onOpenLibrary,
}: HomeProps) {
  const [notice, setNotice] = useState("")
  const [datasets, setDatasets] = useState<Dataset[]>([])

  useEffect(() => {
    libraryDatasets()
      .then(setDatasets)
      .catch((failure: unknown) => setNotice(toErrorMessage(failure)))
  }, [])

  const featured = datasets
    .filter((dataset) => dataset.isFeatured)
    .slice(0, SHOWN_DATASETS)
  const title = openingName
    ? `Opening ${openingName}`
    : isDragging
      ? "Drop to open"
      : "Drop files anywhere"

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6 pb-10">
      <div
        aria-hidden="true"
        className={cn(
          "absolute inset-0 dot-field text-foreground/25",
          isDragging && "opacity-0 [--dot-clearing:36%]"
        )}
      />
      <div
        aria-hidden="true"
        className={cn(
          "absolute inset-0 dot-field text-primary",
          isDragging ? "[--dot-clearing:36%]" : "opacity-0"
        )}
      />
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-3 rounded-xl border border-dashed border-primary/70 transition-[opacity,scale] duration-300 ease-native",
          !isDragging && "scale-[0.985] opacity-0"
        )}
      />
      <div className="relative flex w-full max-w-116 animate-stagger flex-col">
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-xl font-medium">
            <span key={title} className="block animate-fade">
              {title}
            </span>
          </h1>
          <p className="text-muted-foreground">
            {projectName
              ? `Excel, CSV, Parquet, or JSON, or a folder of them. Copied into ${projectName}, and your originals stay as they are.`
              : "Excel, CSV, Parquet, or JSON, or a folder of them. They stay on this computer."}
          </p>
          <Button
            onClick={onBrowse}
            disabled={Boolean(openingName)}
            className="mt-3"
          >
            {openingName && <Spinner data-icon="inline-start" />}
            Browse files
          </Button>
        </div>
        <div
          className={cn(
            "mt-8 grid grid-cols-2 gap-2 transition-[opacity,scale] duration-300 ease-native",
            isDragging && "scale-[0.985] opacity-30"
          )}
        >
          <SourceCard title="Connect">
            {CONNECTIONS.map(({ kind, color, name }) => (
              <SourceRow
                key={name}
                name={name}
                onClick={() =>
                  projectName ? onConnect(kind) : setNotice(NEEDS_PROJECT)
                }
                tile={
                  <span
                    className="grid size-4.5 shrink-0 place-items-center rounded-sm text-white"
                    style={{ backgroundColor: color }}
                  >
                    <DatabaseIcon kind={kind} className="size-3" />
                  </span>
                }
              />
            ))}
          </SourceCard>
          <SourceCard title="From the Library">
            {featured.map((dataset) => (
              <SourceRow
                key={dataset.id}
                name={dataset.title}
                onClick={() => onOpenDataset(dataset.id)}
                tile={<IconTile icon={CATEGORY_ICONS[dataset.category]} />}
              />
            ))}
            <SourceRow
              name="Browse the Library"
              onClick={onOpenLibrary}
              tile={<IconTile icon={ArrowRight01Icon} />}
            />
          </SourceCard>
        </div>
        <p
          role="status"
          className={cn(
            "mt-3 min-h-4 text-center text-xs text-subtle",
            error && "text-destructive"
          )}
        >
          {error ?? notice}
        </p>
      </div>
    </div>
  )
}
