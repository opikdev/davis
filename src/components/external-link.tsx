import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { openExternal } from "@/lib/open-external"

type ExternalLinkProps = {
  href: string
  label?: string
  className?: string
  children: React.ReactNode
}

export function ExternalLink({
  href,
  label,
  className,
  children,
}: ExternalLinkProps) {
  return (
    <Button
      render={<a href={href} />}
      nativeButton={false}
      variant="link"
      aria-label={label}
      className={cn("h-auto gap-0.5 p-0 text-sm", className)}
      onClick={(event) => {
        event.preventDefault()
        openExternal(href)
      }}
    >
      {children}
      <HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={1.5} />
    </Button>
  )
}
