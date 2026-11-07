import {
  BubbleChatIcon,
  Database01Icon,
  LockIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { useEffect } from "react"

import { DataDots } from "@/components/data-dots"
import { StepLayout } from "@/components/step-layout"
import { Button } from "@/components/ui/button"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { playOpeningSound } from "@/lib/sound/player"

const HIGHLIGHTS: { icon: IconSvgElement; title: string; detail: string }[] = [
  {
    icon: Database01Icon,
    title: "Built for large files",
    detail: "Open CSV and Parquet files too big for a spreadsheet.",
  },
  {
    icon: BubbleChatIcon,
    title: "Ask in plain language",
    detail: "Get answers and charts without writing a query.",
  },
  {
    icon: LockIcon,
    title: "Private by default",
    detail: "Your files stay on this computer. You choose what AI can see.",
  },
]

export function WelcomeStep({
  stepLabel,
  onContinue,
}: {
  stepLabel: string
  onContinue: () => void
}) {
  useEffect(playOpeningSound, [])

  return (
    <StepLayout
      stepLabel={stepLabel}
      title="Get answers from your data"
      leadingAction={
        <span className="text-xs text-muted-foreground">
          Open source. No account needed.
        </span>
      }
      trailingAction={<Button onClick={onContinue}>Get started</Button>}
    >
      <DataDots />
      <ItemGroup className="animate-stagger gap-1">
        {HIGHLIGHTS.map(({ icon, title, detail }) => (
          <Item key={title} role="listitem" className="items-start px-0">
            <ItemMedia>
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
          </Item>
        ))}
      </ItemGroup>
    </StepLayout>
  )
}
