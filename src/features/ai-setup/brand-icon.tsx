import { Link01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { cn } from "@/lib/utils"

const BRAND_ICONS = import.meta.glob<string>("./brand-icons/mono/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
})

export function brandIconUrl(icon?: string) {
  return BRAND_ICONS[`./brand-icons/mono/${icon}.svg`]
}

export function BrandIcon({
  icon,
  className,
}: {
  icon?: string
  className?: string
}) {
  const url = brandIconUrl(icon)

  if (url) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "size-5 shrink-0 bg-current mask-contain mask-center mask-no-repeat",
          className
        )}
        style={{ maskImage: `url("${url}")` }}
      />
    )
  }

  return (
    <HugeiconsIcon
      icon={Link01Icon}
      strokeWidth={1.5}
      className={cn("size-5 shrink-0 text-muted-foreground", className)}
    />
  )
}
