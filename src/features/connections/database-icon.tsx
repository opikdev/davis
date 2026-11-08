import { cn } from "@/lib/utils"
import type { DatabaseKind } from "@/features/connections/api"

const ICONS = import.meta.glob<string>("./brand-icons/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
})

export function DatabaseIcon({
  kind,
  className,
}: {
  kind: DatabaseKind
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      data-icon={kind}
      className={cn(
        "size-4 shrink-0 bg-current mask-contain mask-center mask-no-repeat",
        className
      )}
      style={{ maskImage: `url("${ICONS[`./brand-icons/${kind}.svg`]}")` }}
    />
  )
}
