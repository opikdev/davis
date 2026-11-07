import {
  AiChat02Icon,
  DashboardSquare01Icon,
  Database01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import type { PanelImperativeHandle } from "react-resizable-panels"

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
import { ChatPanel, deleteChat, useChat } from "@/features/chat"
import {
  chooseFiles,
  DataView,
  fileName,
  openTable,
  useOpenTable,
  type OpenedTable,
} from "@/features/data"
import { Home, useFileDrop } from "@/features/home"
import {
  addProjectFile,
  removeProjectFile,
  useProject,
  type ChatSummary,
  type Project,
  type ProjectFile,
} from "@/features/projects"
import { toErrorMessage } from "@/lib/ipc-error"
import { cn } from "@/lib/utils"

const CHAT_WIDTH = "19rem"
const CHAT_MIN_WIDTH = "16rem"

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
  projectName?: string
  error?: string
  isDragging: boolean
  onBrowse: () => void
}

function CurrentView({
  view,
  files,
  projectName,
  error,
  isDragging,
  onBrowse,
}: CurrentViewProps) {
  switch (view) {
    case "home":
      return (
        <Home
          isDragging={isDragging}
          projectName={projectName}
          openingName={files.openingName}
          error={error ?? files.error}
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

function projectNameFor(path: string) {
  return fileName(path).split(".")[0]
}

export function Workspace() {
  const [view, setView] = useState<View>("home")
  const [isChatOpen, setIsChatOpen] = useState(true)
  const [projectError, setProjectError] = useState<string>()
  const projects = useProject()
  const { project, loadLast, refresh } = projects
  const files = useOpenTable()
  const onChatSaved = useCallback(
    (path: string) => void refresh(path),
    [refresh]
  )
  const chat = useChat(project?.path, files.table, onChatSaved)
  const chatPanel = useRef<PanelImperativeHandle>(null)
  const chatContent = useRef<HTMLDivElement>(null)
  const chatWidth = useRef(CHAT_WIDTH)
  const showsTable = view === "data" && Boolean(files.table)
  const showsChat = showsTable && isChatOpen
  const [keepsChat, setKeepsChat] = useState(false)
  if (showsChat && !keepsChat) setKeepsChat(true)

  useEffect(() => {
    const panel = chatPanel.current
    if (!panel) return
    if (showsChat) {
      panel.resize(chatWidth.current)
      return
    }
    const { asPercentage } = panel.getSize()
    if (asPercentage) chatWidth.current = `${asPercentage}%`
    panel.resize(0)
  }, [showsChat])

  const { clear: clearChat, open: restoreChat } = chat
  const { close: closeTable, open: openPath } = files

  const restoreProject = useCallback(
    async (entered: Project) => {
      const [latestChat] = entered.chats
      const saved = latestChat
        ? await restoreChat(entered.path, latestChat.id)
        : undefined
      const file =
        entered.files.find(({ name }) => name === saved?.table) ??
        entered.files[0]
      if (!file) return
      await openPath(file.path)
      setView("data")
    },
    [openPath, restoreChat]
  )

  const enterProject = useCallback(
    async (entered: Project) => {
      setProjectError(undefined)
      clearChat()
      closeTable()
      setView("home")
      await restoreProject(entered)
    },
    [clearChat, closeTable, restoreProject]
  )

  const hasStarted = useRef(false)
  useEffect(() => {
    if (hasStarted.current) return
    hasStarted.current = true
    loadLast()
      .then((last) => (last ? restoreProject(last) : undefined))
      .catch((failure: unknown) => setProjectError(toErrorMessage(failure)))
  }, [loadLast, restoreProject])

  async function runProjectAction(action: () => Promise<Project>) {
    try {
      await enterProject(await action())
    } catch (failure) {
      setProjectError(toErrorMessage(failure))
      setView("home")
    }
  }

  async function renameCurrent(name: string) {
    if (!project) return
    const renamed = await projects.rename(project.path, name)
    const file = renamed.files.find(({ name }) => name === files.table?.name)
    if (file) await files.open(file.path)
  }

  async function addFiles(paths: string[]) {
    if (paths.length === 0) return
    setProjectError(undefined)
    setView("home")
    let target = project
    let hasAdded = false
    for (const path of paths) {
      const wasAdded = await files.load(fileName(path), async () => {
        if (!target) {
          // A file Davis can't read shouldn't leave an empty project behind.
          await openTable(path)
          target = await projects.create(projectNameFor(path))
        }
        return addProjectFile(target.path, path)
      })
      hasAdded ||= wasAdded
    }
    if (target) await refresh(target.path)
    if (hasAdded) setView("data")
  }

  async function browse() {
    await addFiles(await chooseFiles())
  }

  function openFile(file: ProjectFile) {
    setView("data")
    void files.open(file.path)
  }

  async function removeFile(file: ProjectFile) {
    if (!project) return
    await removeProjectFile(project.path, file.name)
    await refresh(project.path)
    if (files.table?.name !== file.name) return
    const next = project.files.find(({ name }) => name !== file.name)
    if (next) {
      void files.open(next.path)
    } else {
      files.close()
      setView("home")
    }
  }

  function startChat() {
    chat.clear()
    setIsChatOpen(true)
    if (files.table) setView("data")
  }

  async function openChat(summary: ChatSummary) {
    if (!project) return
    const saved = await chat.open(project.path, summary.id)
    setIsChatOpen(true)
    const file = project.files.find(({ name }) => name === saved.table)
    if (file && file.name !== files.table?.name) await files.open(file.path)
    if (file ?? files.table) setView("data")
  }

  async function removeChat(summary: ChatSummary) {
    if (!project) return
    await deleteChat(project.path, summary.id)
    if (summary.id === chat.chatId) chat.clear()
    await refresh(project.path)
  }

  const isDragging = useFileDrop((paths) => void addFiles(paths))

  return (
    <SidebarProvider className="h-svh animate-fade">
      <div data-tauri-drag-region className="fixed inset-x-0 top-0 z-20 h-1" />
      <AppSidebar
        project={project}
        recent={projects.recent}
        isBusy={chat.isAsking}
        onOpen={(path) => void runProjectAction(() => projects.open(path))}
        onCreate={async (name) => enterProject(await projects.create(name))}
        onRename={renameCurrent}
        view={view}
        activeFile={files.table?.name}
        activeChat={chat.chatId}
        onViewChange={setView}
        onAddFiles={() => void browse()}
        onOpenFile={openFile}
        onRemoveFile={(file) => void removeFile(file)}
        onNewChat={startChat}
        onOpenChat={(summary) => void openChat(summary)}
        onDeleteChat={(summary) => void removeChat(summary)}
      />
      <SidebarInset className="min-h-0 overflow-hidden bg-transparent md:peer-data-[variant=inset]:rounded-none md:peer-data-[variant=inset]:border-0">
        <ResizablePanelGroup
          orientation="horizontal"
          className="@container animate-panels"
          onLayoutChange={({ chat: share }) => {
            if (share && chatContent.current) {
              chatContent.current.style.width = `${share}cqw`
            }
          }}
          onLayoutChanged={({ chat: share }) => {
            if (share === 0 && showsChat) setIsChatOpen(false)
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
                  projectName={project?.name}
                  error={projectError}
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
          <ResizableHandle
            disabled={!showsChat}
            className="w-0 bg-transparent after:left-0 after:w-1.5 after:translate-x-0 hover:after:bg-foreground/10 focus-visible:ring-0"
          />
          <ResizablePanel
            id="chat"
            panelRef={chatPanel}
            collapsible
            collapsedThreshold={CHAT_MIN_WIDTH}
            defaultSize={0}
            minSize={CHAT_MIN_WIDTH}
            maxSize="34rem"
            style={{ overflow: "hidden" }}
            onTransitionEnd={(event) => {
              if (!showsChat && event.target === event.currentTarget) {
                setKeepsChat(false)
              }
            }}
          >
            {/* Keeps its width while the panel slides, so nothing reflows. */}
            <div
              ref={chatContent}
              inert={!showsChat}
              style={{ width: CHAT_WIDTH }}
              className={cn(
                "h-full pl-1.5 transition-opacity duration-200 ease-native",
                !showsChat && "opacity-0"
              )}
            >
              {keepsChat && files.table && (
                <ChatPanel table={files.table} chat={chat} />
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </SidebarInset>
    </SidebarProvider>
  )
}
