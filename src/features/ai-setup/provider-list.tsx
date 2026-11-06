import { Fragment } from "react"

import { cn } from "cn"

import { ItemGroup, ItemSeparator } from "@/components/ui/item"
import type { Provider } from "@/features/ai-setup/catalog"

type ProviderListProps = {
  className?: string
  providers: Provider[]
  renderRow: (provider: Provider) => React.ReactNode
}

export function ProviderList({
  className,
  providers,
  renderRow,
}: ProviderListProps) {
  return (
    <ItemGroup className={cn("gap-0", className)}>
      {providers.map((provider, index) => (
        <Fragment key={provider.id}>
          {index > 0 && <ItemSeparator aria-hidden className="my-0" />}
          {renderRow(provider)}
        </Fragment>
      ))}
    </ItemGroup>
  )
}
