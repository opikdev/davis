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
  EmptyContent,
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
import { LibraryView, type ImportedDataset } from "@/features/library"
import {
  ConnectDatabaseDialog,
  openDatabaseTable,
  ReconnectDialog,
  removeDatabaseTable,
  tableLabel,
  type ConnectedTable,
  type DatabaseConnection,
  type DatabaseKind,
} from "@/features/connections"
import {
  ChatPanel,
  deleteChat,
  useChat,
  type Figure,
  type StoredQuery,
} from "@/features/chat"
import {
  chooseFiles,
  chooseReplacement,
  DataView,
  fileName,
  useOpenTable,
  useProfile,
  type OpenedTable,
} from "@/features/data"
import { Home, useFileDrop } from "@/features/home"
import {
  BlockSettings,
  findBlock,
  PageView,
  PinMenu,
  usePage,
} from "@/features/pages"
import {
  addProjectFile,
  checkReplacement,
  ConfirmRemoval,
  checkDataFile,
  dataFilesIn,
  LinkedFiles,
  removeProjectFile,
  replaceProjectFile,
  useProject,
  type ChatSummary,
  type PageSummary,
  type Project,
  type ProjectFile,
} from "@/features/projects"
import { errorKind, toErrorMessage } from "@/lib/ipc-error"
import { cn } from "@/lib/utils"

const CHAT_WIDTH = "19rem"
const CHAT_MIN_WIDTH = "16rem"

function PanelHeader({
  view,
  table,
  pageTitle,
  action,
}: {
  view: View
  table?: OpenedTable
  pageTitle?: string
  action: ReactNode
}) {
  const { state } = useSidebar()
  const showsTable = view === "data" && table
  const detail = showsTable ? table.name : view === "page" && pageTitle

  return (
    <header
      data-tauri-drag-region="deep"
      className={cn(
        "flex h-9 shrink-0 items-center gap-1.5 border-b px-1.5",
        state === "collapsed" && "macos:pl-20"
      )}
    >
      <SidebarTrigger aria-label="Toggle sidebar" />
      <span className={detail ? "text-muted-foreground" : "text-foreground"}>
        {VIEW_LABELS[view]}
      </span>
      {detail && (
        <>
          <span className="text-subtle">/</span>
          <span className="truncate text-foreground">{detail}</span>
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
  action,
}: {
  icon: IconSvgElement
  title: string
  description: string
  action?: ReactNode
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
      {action && <EmptyContent>{action}</EmptyContent>}
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
  project?: string
  pages: ReturnType<typeof usePage>
  hasData: boolean
  isAsking: boolean
  onNewPage: () => void
  projectName?: string
  error?: string
  isDragging: boolean
  onBrowse: () => void
  onReconnect: (connectionId: string) => void
  credits: string[]
  currentProject?: Project
  onImported: (imported: ImportedDataset) => void
  libraryDataset?: string
  onConnect: (kind: DatabaseKind) => void
  onOpenDataset: (id: string) => void
  onOpenLibrary: () => void
}

function CurrentView({
  view,
  files,
  project,
  pages,
  hasData,
  isAsking,
  onNewPage,
  projectName,
  error,
  isDragging,
  onBrowse,
  onReconnect,
  credits,
  currentProject,
  onImported,
  libraryDataset,
  onConnect,
  onOpenDataset,
  onOpenLibrary,
}: CurrentViewProps) {
  switch (view) {
    case "library":
      return (
        <LibraryView
          project={currentProject}
          openDatasetId={libraryDataset}
          onImported={onImported}
        />
      )
    case "home":
      return (
        <Home
          isDragging={isDragging}
          projectName={projectName}
          openingName={files.openingName}
          error={error ?? files.error}
          onBrowse={onBrowse}
          onConnect={onConnect}
          onOpenDataset={onOpenDataset}
          onOpenLibrary={onOpenLibrary}
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
    case "page":
      return project && pages.page ? (
        <PageView
          project={project}
          pages={pages}
          hasData={hasData}
          isLocked={isAsking}
          credits={credits}
          onReconnect={onReconnect}
        />
      ) : (
        <EmptyView
          icon={DashboardSquare01Icon}
          title="No Page open"
          description="Pages are dashboards you build from your answers."
          action={project && <Button onClick={onNewPage}>New Page</Button>}
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
  const profile = useProfile(files.table?.source)
  const onChatSaved = useCallback(
    (path: string) => void refresh(path),
    [refresh]
  )
  const pages = usePage(project?.path, onChatSaved)
  const {
    reload: reloadPage,
    close: closePage,
    open: openPageById,
    create: createPage,
    addTo: addToPage,
  } = pages
  const reloadRef = useRef(reloadPage)
  useEffect(() => {
    reloadRef.current = reloadPage
  }, [reloadPage])
  const onPageChanged = useCallback(() => void reloadRef.current(), [])
  const [askedBlockId, setAskedBlockId] = useState<string>()
  const [connectKind, setConnectKind] = useState<DatabaseKind>()
  const [libraryDataset, setLibraryDataset] = useState<string>()
  const pendingPage = useRef<string>(undefined)
  const [reconnecting, setReconnecting] = useState<{
    connection: DatabaseConnection
    afterwards: () => void
  }>()
  const [replacement, setReplacement] = useState<{
    file: ProjectFile
    path: string
    missingColumns: string[]
  }>()
  const pageRows = view === "page" ? pages.page?.rows : undefined
  const askedBlock = pageRows && findBlock(pageRows, askedBlockId)
  const chat = useChat(
    project?.path,
    files.table,
    onChatSaved,
    view === "page" ? pages.page?.id : undefined,
    onPageChanged,
    askedBlock?.id
  )
  const chatPanel = useRef<PanelImperativeHandle>(null)
  const chatContent = useRef<HTMLDivElement>(null)
  const chatWidth = useRef(CHAT_WIDTH)
  const showsTable = view === "data" && Boolean(files.table)
  const showsPage = view === "page" && Boolean(pages.page)
  const settingsBlock =
    pages.isEditing && pageRows
      ? findBlock(pageRows, pages.selectedId)
      : undefined
  const showsChat =
    (showsTable || showsPage) && (isChatOpen || Boolean(settingsBlock))
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

  const pageList = project?.pages
  const figureAction = useCallback(
    (figure: Figure, query: StoredQuery) => {
      async function pin(pageId: string | undefined) {
        setView("page")
        if (pageId) await openPageById(pageId)
        else await createPage()
        await addToPage(pageId, {
          kind: "figure",
          title: figure.title,
          sql: query.pageSql ?? query.sql,
          view: figure.view,
          xColumn: figure.x,
          yColumn: figure.y,
        })
      }
      return <PinMenu pages={pageList ?? []} onPin={(id) => void pin(id)} />
    },
    [addToPage, createPage, openPageById, pageList]
  )

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
      closePage()
      setView("home")
      await restoreProject(entered)
    },
    [clearChat, closePage, closeTable, restoreProject]
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

  async function addFiles(dropped: string[]) {
    if (dropped.length === 0) return
    setProjectError(undefined)
    const paths = await dataFilesIn(dropped)
    if (paths.length === 0) {
      setProjectError("That folder has no data files in it.")
      return
    }
    setView("home")
    let target = project
    let hasAdded = false
    for (const path of paths) {
      const wasAdded = await files.load(fileName(path), async () => {
        if (!target) {
          // A file Davis can't read shouldn't leave an empty project behind.
          await checkDataFile(path)
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

  async function applyReplacement(file: ProjectFile, path: string) {
    if (!project) return
    setReplacement(undefined)
    await replaceProjectFile(project.path, file.name, path)
    await refresh(project.path)
    if (files.table?.name === file.name) {
      files.close()
      await files.open(file.path)
    }
    if (pages.page) await reloadPage()
  }

  async function replaceFile(file: ProjectFile) {
    if (!project) return
    const path = await chooseReplacement(file.name)
    if (!path) return
    const { missingColumns } = await checkReplacement(
      project.path,
      file.name,
      path
    )
    if (missingColumns.length > 0) {
      setReplacement({ file, path, missingColumns })
    } else {
      await applyReplacement(file, path)
    }
  }

  function reportReplaceFailure(failure: unknown) {
    setProjectError(toErrorMessage(failure))
    setView("home")
  }

  // A new project's Page can only open once the Page hook knows the project.
  useEffect(() => {
    const id = pendingPage.current
    if (!id || !project) return
    pendingPage.current = undefined
    void openPageById(id)
  }, [openPageById, project])

  async function showImported({
    project: imported,
    files: added,
    pageId,
  }: ImportedDataset) {
    pendingPage.current = pageId ?? undefined
    if (imported.path === project?.path) {
      await refresh(imported.path)
    } else {
      clearChat()
      closePage()
      await projects.open(imported.path)
    }
    const file = imported.files.find(({ name }) => name === added[0])
    if (file) await files.open(file.path)
    setView(pageId ? "page" : "data")
  }

  function openDatabase(connection: DatabaseConnection, table: ConnectedTable) {
    if (!project) return
    const path = project.path
    setView("data")
    void files.load(tableLabel(connection, table), async () => {
      try {
        return await openDatabaseTable(path, connection.id, table)
      } catch (failure) {
        if (errorKind(failure) === "disconnected-database") {
          setReconnecting({
            connection,
            afterwards: () => openDatabase(connection, table),
          })
        }
        throw failure
      }
    })
  }

  async function removeDatabase(
    connection: DatabaseConnection,
    table: ConnectedTable
  ) {
    if (!project) return
    await removeDatabaseTable(project.path, connection.id, table)
    await refresh(project.path)
    if (files.table?.name === tableLabel(connection, table)) {
      files.close()
      setView("home")
    }
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

  async function newPage() {
    const created = await pages.create()
    if (created) setView("page")
    return created
  }

  async function openPage(summary: PageSummary) {
    setView("page")
    await pages.open(summary.id)
  }

  function startChat() {
    chat.clear()
    setIsChatOpen(true)
    if (files.table && view !== "page") setView("data")
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
        activePage={pages.page?.id}
        onNewPage={() => void newPage()}
        onOpenPage={(summary) => void openPage(summary)}
        onDeletePage={(summary) => void pages.remove(summary.id)}
        onViewChange={(next) => {
          setLibraryDataset(undefined)
          setView(next)
        }}
        onAddFiles={() => void browse()}
        onConnectDatabase={() => setConnectKind("postgres")}
        onOpenFile={openFile}
        onOpenDatabaseTable={openDatabase}
        onRemoveDatabaseTable={(connection, table) =>
          void removeDatabase(connection, table).catch(reportReplaceFailure)
        }
        onReplaceFile={(file) =>
          void replaceFile(file).catch(reportReplaceFailure)
        }
        onRemoveFile={(file) => void removeFile(file)}
        onNewChat={startChat}
        onOpenChat={(summary) => void openChat(summary)}
        onDeleteChat={(summary) => void removeChat(summary)}
      />
      {connectKind && project && (
        <ConnectDatabaseDialog
          project={project}
          initialKind={connectKind}
          onAdded={(updated, connectionId) => {
            setConnectKind(undefined)
            void refresh(updated.path)
            const connection = updated.connections.find(
              ({ id }) => id === connectionId
            )
            if (connection) openDatabase(connection, connection.tables[0])
          }}
          onClose={() => setConnectKind(undefined)}
        />
      )}
      {reconnecting && project && (
        <ReconnectDialog
          project={project.path}
          connection={reconnecting.connection}
          onReconnected={(updated) => {
            setReconnecting(undefined)
            void refresh(updated.path)
            reconnecting.afterwards()
          }}
          onClose={() => setReconnecting(undefined)}
        />
      )}
      {replacement && (
        <ConfirmRemoval
          title={`Replace ${replacement.file.name}?`}
          description={`The new file doesn't have ${replacement.missingColumns.join(", ")}. Blocks that use these columns will show an error until you change them.`}
          action="Replace file"
          onConfirm={() =>
            void applyReplacement(replacement.file, replacement.path).catch(
              reportReplaceFailure
            )
          }
          onClose={() => setReplacement(undefined)}
        />
      )}
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
                pageTitle={pages.page?.title}
                action={
                  (showsTable || showsPage) && (
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
                  project={project?.path}
                  pages={pages}
                  hasData={Boolean(
                    project?.files.length || project?.connections.length
                  )}
                  isAsking={chat.isAsking}
                  onNewPage={() => void newPage()}
                  projectName={project?.name}
                  error={projectError}
                  isDragging={isDragging}
                  onBrowse={() => void browse()}
                  currentProject={project}
                  credits={(project?.sources ?? []).map(
                    ({ credit, license }) => `${credit} ${license}.`
                  )}
                  onImported={(imported) =>
                    void showImported(imported).catch(reportReplaceFailure)
                  }
                  libraryDataset={libraryDataset}
                  onConnect={setConnectKind}
                  onOpenDataset={(id) => {
                    setLibraryDataset(id)
                    setView("library")
                  }}
                  onOpenLibrary={() => setView("library")}
                  onReconnect={(connectionId) => {
                    const connection = project?.connections.find(
                      ({ id }) => id === connectionId
                    )
                    if (connection) {
                      setReconnecting({
                        connection,
                        afterwards: () => void reloadPage(),
                      })
                    }
                  }}
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
                      profile={profile}
                      footerAction={
                        project && (
                          <LinkedFiles
                            project={project.path}
                            fileName={files.table.name}
                            fileCount={project.files.length}
                            onCombined={(table) => {
                              void refresh(project.path)
                              void files.load(table.name, async () => table)
                            }}
                          />
                        )
                      }
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
              {settingsBlock && project && (
                <BlockSettings
                  key={settingsBlock.id}
                  project={project.path}
                  block={settingsBlock}
                  onChange={(change, shouldRun) =>
                    pages.updateBlock(settingsBlock.id, change, shouldRun)
                  }
                  onClose={() => pages.select(undefined)}
                  onAskAi={() => {
                    setAskedBlockId(settingsBlock.id)
                    setIsChatOpen(true)
                    pages.select(undefined)
                  }}
                />
              )}
              {keepsChat && (files.table || showsPage) && (
                <div className={cn("h-full", settingsBlock && "hidden")}>
                  <ChatPanel
                    table={files.table}
                    pageTitle={showsPage ? pages.page?.title : undefined}
                    blockTitle={askedBlock && (askedBlock.title || "this text")}
                    onClearBlock={() => setAskedBlockId(undefined)}
                    profile={profile}
                    chat={chat}
                    figureAction={figureAction}
                  />
                </div>
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </SidebarInset>
    </SidebarProvider>
  )
}
