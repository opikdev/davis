import {
  Bicycle01Icon,
  CloudIcon,
  Megaphone01Icon,
  ShoppingBag01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import mysqlIcon from "@/features/home/connection-icons/mysql.svg"
import postgresqlIcon from "@/features/home/connection-icons/postgresql.svg"
import { useFileDrop } from "@/features/home/use-file-drop"
import { cn } from "@/lib/utils"

const NOT_READY = "Opening data is the next step we're building."

const CONNECTIONS = [
  { logo: postgresqlIcon, color: "#336791", name: "PostgreSQL" },
  { logo: mysqlIcon, color: "#00758f", name: "MySQL" },
]

const DATASETS: { icon: IconSvgElement; name: string; size: string }[] = [
  { icon: ShoppingBag01Icon, name: "Online retail", size: "1.07M rows" },
  { icon: Megaphone01Icon, name: "Bank marketing", size: "45K rows" },
  { icon: Bicycle01Icon, name: "Bike sharing", size: "17K rows" },
]

function fileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path
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
      className="h-9 w-full justify-start gap-2.5 px-2 font-normal"
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
    <section className="flex flex-col rounded-xl border bg-background p-1.5">
      <h2 className="px-2 pt-1.5 pb-1 text-xs text-subtle">{title}</h2>
      {children}
    </section>
  )
}

export function Home() {
  const [notice, setNotice] = useState("")
  const isDragging = useFileDrop((paths) =>
    setNotice(`${fileName(paths[0] ?? "")}: ${NOT_READY.toLowerCase()}`)
  )
  const showNotReady = () => setNotice(NOT_READY)

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
      <div className="relative flex w-full max-w-138 animate-stagger flex-col">
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-xl font-medium">
            <span key={String(isDragging)} className="block animate-fade">
              {isDragging ? "Drop to open" : "Drop files anywhere"}
            </span>
          </h1>
          <p className="text-muted-foreground">
            CSV, Parquet, JSON, Excel, or SQLite. They stay on this computer.
          </p>
          <Button onClick={showNotReady} className="mt-4">
            Browse files
          </Button>
        </div>
        <div
          className={cn(
            "mt-10 grid grid-cols-2 gap-2.5 transition-[opacity,scale] duration-300 ease-native",
            isDragging && "scale-[0.985] opacity-30"
          )}
        >
          <SourceCard title="Connect">
            {CONNECTIONS.map(({ logo, color, name }) => (
              <SourceRow
                key={name}
                name={name}
                onClick={showNotReady}
                tile={
                  <span
                    className="grid size-5 shrink-0 place-items-center rounded-md"
                    style={{ backgroundColor: color }}
                  >
                    <img
                      src={logo}
                      alt=""
                      className="size-3.5 brightness-0 invert"
                    />
                  </span>
                }
              />
            ))}
            <SourceRow
              name="Cloud storage"
              detail="S3, web link"
              onClick={showNotReady}
              tile={
                <span className="grid size-5 shrink-0 place-items-center rounded-md bg-muted">
                  <HugeiconsIcon icon={CloudIcon} strokeWidth={1.5} />
                </span>
              }
            />
          </SourceCard>
          <SourceCard title="Sample datasets">
            {DATASETS.map(({ icon, name, size }) => (
              <SourceRow
                key={name}
                name={name}
                detail={size}
                onClick={showNotReady}
                tile={
                  <span className="grid size-5 shrink-0 place-items-center rounded-md bg-muted">
                    <HugeiconsIcon icon={icon} strokeWidth={1.5} />
                  </span>
                }
              />
            ))}
          </SourceCard>
        </div>
        <p role="status" className="mt-3 h-4 text-center text-xs text-subtle">
          {notice}
        </p>
      </div>
    </div>
  )
}
