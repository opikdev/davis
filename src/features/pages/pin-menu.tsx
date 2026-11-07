import { Add01Icon, PinIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type PinMenuProps = {
  pages: { id: string; title: string }[]
  onPin: (pageId: string | undefined) => void
}

export function PinMenu({ pages, onPin }: PinMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Add to a Page"
            className="size-5"
          />
        }
      >
        <HugeiconsIcon icon={PinIcon} strokeWidth={1.5} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {pages.map(({ id, title }) => (
          <DropdownMenuItem key={id} onClick={() => onPin(id)}>
            <span className="truncate">{title}</span>
          </DropdownMenuItem>
        ))}
        {pages.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onClick={() => onPin(undefined)}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={1.5} />
          New Page
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
