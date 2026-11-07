import {
  AiChat02Icon,
  DashboardSquare01Icon,
  Database01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { useState, type ReactNode } from "react"

import { AppSidebar, VIEW_LABELS, type View } from "@/app/app-sidebar"
import { Button } from "@/components/ui/button"
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
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { ModelPicker } from "@/features/ai-setup"
import { ChatPanel, useChat } from "@/features/chat"
import { DataView, useOpenTable, type OpenedTable } from "@/features/data"
import { Home, useFileDrop } from "@/features/home"
import { cn } from "@/lib/utils"

const CHAT_WIDTH = "19rem"

function PanelHeader({
  view,
  table,
  action,
}: {
  view: View
  table?: OpenedTable
  action: ReactNode
}) {
  const { state } = useSidebar()
  const showsTable = view === "data" && table

  return (
    <header
      data-tauri-drag-region="deep"
      className={cn(
        "flex h-9 shrink-0 items-center gap-1.5 border-b px-1.5",
        state === "collapsed" && "macos:pl-20"
      )}
    >
      <SidebarTrigger aria-label="Toggle sidebar" />
      <span
        className={showsTable ? "text-muted-foreground" : "text-foreground"}
      >
        {VIEW_LABELS[view]}
      </span>
      {showsTable && (
        <>
          <span className="text-subtle">/</span>
          <span className="truncate text-foreground">{table.name}</span>
        </>
      )}
      {action}
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
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-6 py-6">
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

type CurrentViewProps = {
  view: View
  files: ReturnType<typeof useOpenTable>
  isDragging: boolean
  onBrowse: () => void
}

function CurrentView({ view, files, isDragging, onBrowse }: CurrentViewProps) {
  switch (view) {
    case "home":
      return (
        <Home
          isDragging={isDragging}
          openingName={files.openingName}
          error={files.error}
          onBrowse={onBrowse}
        />
      )
    case "data":
      return files.table ? null : (
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

function ChatToggle({
  isOpen,
  onToggle,
}: {
  isOpen: boolean
  onToggle: () => void
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={isOpen}
      className="ml-auto shrink-0 font-normal text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
      onClick={onToggle}
    >
      <HugeiconsIcon
        icon={AiChat02Icon}
        strokeWidth={1.5}
        data-icon="inline-start"
      />
      Ask AI
    </Button>
  )
}

export function Workspace() {
  const [view, setView] = useState<View>("home")
  const [isChatOpen, setIsChatOpen] = useState(true)
  const files = useOpenTable()
  const chat = useChat(files.table)
  const [chatWidth, setChatWidth] = useState(CHAT_WIDTH)
  const showsTable = view === "data" && Boolean(files.table)
  const showsChat = showsTable && isChatOpen

  function showResult(isOpen: boolean) {
    setView(isOpen ? "data" : "home")
  }

  async function openDropped(paths: string[]) {
    const [path] = paths
    if (!path) return
    setView("home")
    showResult(await files.open(path))
  }

  async function browse() {
    const wasChosen = await files.browse()
    if (wasChosen !== undefined) showResult(wasChosen)
  }

  const isDragging = useFileDrop((paths) => void openDropped(paths))

  return (
    <SidebarProvider className="h-svh animate-fade">
      <div data-tauri-drag-region className="fixed inset-x-0 top-0 z-20 h-1" />
      <AppSidebar
        view={view}
        fileName={files.table?.name}
        onViewChange={setView}
      />
      <SidebarInset className="min-h-0 overflow-hidden bg-transparent md:peer-data-[variant=inset]:rounded-none md:peer-data-[variant=inset]:border-0">
        <ResizablePanelGroup
          orientation="horizontal"
          onLayoutChanged={({ chat: share }) => {
            if (share) setChatWidth(`${share}%`)
          }}
        >
          <ResizablePanel id="main" minSize="320px">
            <div className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border bg-background">
              <PanelHeader
                view={view}
                table={files.table}
                action={
                  showsTable && (
                    <ChatToggle
                      isOpen={isChatOpen}
                      onToggle={() => setIsChatOpen(!isChatOpen)}
                    />
                  )
                }
              />
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                <CurrentView
                  view={view}
                  files={files}
                  isDragging={isDragging}
                  onBrowse={() => void browse()}
                />
                {files.table && (
                  <div
                    className={cn(
                      "flex min-h-0 flex-1",
                      view !== "data" && "hidden"
                    )}
                  >
                    <DataView
                      key={files.table.source.path}
                      table={files.table}
                    />
                  </div>
                )}
              </div>
            </div>
          </ResizablePanel>
          {showsChat && files.table && (
            <>
              <ResizableHandle className="w-1.5 bg-transparent after:w-1.5 hover:bg-foreground/10 focus-visible:ring-0" />
              <ResizablePanel
                id="chat"
                defaultSize={chatWidth}
                minSize="16rem"
                maxSize="34rem"
              >
                <ChatPanel table={files.table} chat={chat} />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </SidebarInset>
    </SidebarProvider>
  )
}
