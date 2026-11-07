import {
  DashboardSquare01Icon,
  Database01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { useState } from "react"

import { AppSidebar, VIEW_LABELS, type View } from "@/app/app-sidebar"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { ModelPicker } from "@/features/ai-setup"
import { Home } from "@/features/home"
import { cn } from "@/lib/utils"

function PanelHeader({ view }: { view: View }) {
  const { state } = useSidebar()

  return (
    <header
      data-tauri-drag-region="deep"
      className={cn(
        "flex h-10 shrink-0 items-center gap-2 border-b px-2",
        state === "collapsed" && "macos:pl-20"
      )}
    >
      <SidebarTrigger aria-label="Toggle sidebar" />
      <span className="text-foreground">{VIEW_LABELS[view]}</span>
    </header>
  )
}

function EmptyView({
  icon,
  title,
  description,
}: {
  icon: IconSvgElement
  title: string
  description: string
}) {
  return (
    <Empty className="border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={icon} strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>
          <h1>{title}</h1>
        </EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function SettingsView() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-6 py-8">
      <h1 className="sr-only">Settings</h1>
      <Item variant="outline">
        <ItemContent>
          <ItemTitle>AI model</ItemTitle>
          <ItemDescription>Used when you ask about your data</ItemDescription>
        </ItemContent>
        <ItemActions>
          <ModelPicker />
        </ItemActions>
      </Item>
    </div>
  )
}

function CurrentView({ view }: { view: View }) {
  switch (view) {
    case "home":
      return <Home />
    case "data":
      return (
        <EmptyView
          icon={Database01Icon}
          title="No data yet"
          description="Files and connections you add will appear here."
        />
      )
    case "pages":
      return (
        <EmptyView
          icon={DashboardSquare01Icon}
          title="No pages yet"
          description="Dashboards you build will appear here."
        />
      )
    case "settings":
      return <SettingsView />
  }
}

export function Workspace() {
  const [view, setView] = useState<View>("home")

  return (
    <SidebarProvider className="h-svh animate-fade">
      <div data-tauri-drag-region className="fixed inset-x-0 top-0 z-20 h-1" />
      <AppSidebar view={view} onViewChange={setView} />
      <SidebarInset className="min-h-0 overflow-hidden">
        <PanelHeader view={view} />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <CurrentView view={view} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
