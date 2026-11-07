import {
  ArrowRight01Icon,
  ComputerIcon,
  Key01Icon,
  ToolsIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"

import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import type { ProviderGroup } from "@/features/ai-setup/catalog"

const OPTIONS: {
  group: ProviderGroup
  icon: IconSvgElement
  title: string
  detail: string
}[] = [
  {
    group: "app",
    icon: ToolsIcon,
    title: "Use an AI tool",
    detail: "Install Claude Code, Codex, or another tool and sign in",
  },
  {
    group: "api-key",
    icon: Key01Icon,
    title: "Use an API key",
    detail: "Paste a key from OpenAI, Anthropic, Google, and more",
  },
  {
    group: "local",
    icon: ComputerIcon,
    title: "Run AI on this computer",
    detail: "Private and free, but less accurate than cloud AI",
  },
]

export function StartOptions({
  onSelect,
}: {
  onSelect: (group: ProviderGroup) => void
}) {
  return (
    <ItemGroup className="animate-stagger gap-2" role="group">
      {OPTIONS.map(({ group, icon, title, detail }) => (
        <Item
          key={group}
          variant="outline"
          render={<button type="button" onClick={() => onSelect(group)} />}
          className="cursor-pointer text-left transition-all hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-[0.99]"
        >
          <ItemMedia className="self-center!">
            <HugeiconsIcon
              icon={icon}
              strokeWidth={1.5}
              className="size-5 text-muted-foreground"
            />
          </ItemMedia>
          <ItemContent className="gap-0.5">
            <ItemTitle>{title}</ItemTitle>
            <ItemDescription>{detail}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              strokeWidth={1.5}
              className="size-4 text-muted-foreground"
            />
          </ItemActions>
        </Item>
      ))}
    </ItemGroup>
  )
}
