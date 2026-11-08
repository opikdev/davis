import {
  Add01Icon,
  Books02Icon,
  Cancel01Icon,
  DashboardSquare01Icon,
  Database01Icon,
  File02Icon,
  Home01Icon,
  Message01Icon,
  RepeatIcon,
  Settings01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { useState } from "react"

import { DavisMark } from "@/components/davis-mark"
import { SoundToggle } from "@/components/sound-toggle"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  DatabaseIcon,
  tableLabel,
  type ConnectedTable,
  type DatabaseConnection,
} from "@/features/connections"
import {
  ConfirmRemoval,
  ProjectSwitcher,
  type ChatSummary,
  type PageSummary,
  type ProjectFile,
} from "@/features/projects"

export type View = "home" | "library" | "data" | "page" | "settings"

export const VIEW_LABELS: Record<View, string> = {
  home: "Home",
  library: "Library",
  data: "Data",
  page: "Pages",
  settings: "Settings",
}

const MAIN_ITEMS: { view: View; icon: IconSvgElement }[] = [
  { view: "home", icon: Home01Icon },
  { view: "library", icon: Books02Icon },
]

type Removal =
  | { kind: "file"; file: ProjectFile }
  | { kind: "chat"; chat: ChatSummary }
  | { kind: "page"; page: PageSummary }
  | { kind: "table"; connection: DatabaseConnection; table: ConnectedTable }

type AppSidebarProps = Pick<
  React.ComponentProps<typeof ProjectSwitcher>,
  "project" | "recent" | "isBusy" | "onOpen" | "onCreate" | "onRename"
> & {
  view: View
  activeFile?: string
  activeChat?: string
  activePage?: string
  onNewPage: () => void
  onOpenPage: (page: PageSummary) => void
  onDeletePage: (page: PageSummary) => void
  onViewChange: (view: View) => void
  onAddFiles: () => void
  onConnectDatabase: () => void
  onOpenFile: (file: ProjectFile) => void
  onOpenDatabaseTable: (
    connection: DatabaseConnection,
    table: ConnectedTable
  ) => void
  onRemoveDatabaseTable: (
    connection: DatabaseConnection,
    table: ConnectedTable
  ) => void
  onReplaceFile: (file: ProjectFile) => void
  onRemoveFile: (file: ProjectFile) => void
  onNewChat: () => void
  onOpenChat: (chat: ChatSummary) => void
  onDeleteChat: (chat: ChatSummary) => void
}

export function AppSidebar({
  project,
  recent,
  isBusy,
  onOpen,
  onCreate,
  onRename,
  view,
  activeFile,
  activeChat,
  activePage,
  onNewPage,
  onOpenPage,
  onDeletePage,
  onViewChange,
  onAddFiles,
  onConnectDatabase,
  onOpenFile,
  onOpenDatabaseTable,
  onRemoveDatabaseTable,
  onReplaceFile,
  onRemoveFile,
  onNewChat,
  onOpenChat,
  onDeleteChat,
}: AppSidebarProps) {
  const { state } = useSidebar()
  const [removal, setRemoval] = useState<Removal>()

  return (
    <Sidebar
      variant="inset"
      role="navigation"
      aria-label="Main"
      inert={state === "collapsed"}
    >
      <SidebarHeader
        data-tauri-drag-region="deep"
        className="h-8 flex-row items-center justify-end px-2 py-0"
      >
        <DavisMark className="size-3.5 text-foreground" />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="pb-0">
          <SidebarMenu>
            <SidebarMenuItem>
              <ProjectSwitcher
                project={project}
                recent={recent}
                isBusy={isBusy}
                onOpen={onOpen}
                onCreate={onCreate}
                onRename={onRename}
              />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarMenu className="gap-0">
            {MAIN_ITEMS.map((item) => (
              <SidebarMenuItem key={item.view}>
                <SidebarMenuButton
                  isActive={view === item.view}
                  onClick={() => onViewChange(item.view)}
                >
                  <HugeiconsIcon icon={item.icon} strokeWidth={1.5} />
                  {VIEW_LABELS[item.view]}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
        {project && (
          <>
            <SidebarGroup>
              <SidebarGroupLabel>Pages</SidebarGroupLabel>
              <SidebarGroupAction
                aria-label="New Page"
                disabled={isBusy}
                onClick={onNewPage}
              >
                <HugeiconsIcon icon={Add01Icon} strokeWidth={1.5} />
              </SidebarGroupAction>
              <SidebarMenu className="gap-0">
                {project.pages.map((page) => (
                  <SidebarMenuItem key={page.id}>
                    <SidebarMenuButton
                      title={page.title}
                      disabled={isBusy}
                      isActive={view === "page" && page.id === activePage}
                      onClick={() => onOpenPage(page)}
                    >
                      <HugeiconsIcon
                        icon={DashboardSquare01Icon}
                        strokeWidth={1.5}
                      />
                      <span className="truncate">{page.title}</span>
                    </SidebarMenuButton>
                    <SidebarMenuAction
                      showOnHover
                      aria-label={`Delete ${page.title}`}
                      disabled={isBusy}
                      onClick={() => setRemoval({ kind: "page", page })}
                    >
                      <HugeiconsIcon icon={Cancel01Icon} strokeWidth={1.5} />
                    </SidebarMenuAction>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupLabel>Data</SidebarGroupLabel>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<SidebarGroupAction aria-label="Add data" />}
                >
                  <HugeiconsIcon icon={Add01Icon} strokeWidth={1.5} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={onAddFiles}>
                    <HugeiconsIcon icon={File02Icon} strokeWidth={1.5} />
                    Add files
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onConnectDatabase}>
                    <HugeiconsIcon icon={Database01Icon} strokeWidth={1.5} />
                    Connect a database
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <SidebarMenu className="gap-0">
                {project.files.map((file) => (
                  <SidebarMenuItem key={file.path}>
                    <SidebarMenuButton
                      title={file.name}
                      isActive={view === "data" && file.name === activeFile}
                      className="group-hover/menu-item:pr-13"
                      onClick={() => onOpenFile(file)}
                    >
                      <HugeiconsIcon icon={File02Icon} strokeWidth={1.5} />
                      <span className="truncate">{file.name}</span>
                    </SidebarMenuButton>
                    <SidebarMenuAction
                      showOnHover
                      aria-label={`Replace ${file.name}`}
                      title={`Replace ${file.name} with a newer file`}
                      disabled={isBusy}
                      className="right-6"
                      onClick={() => onReplaceFile(file)}
                    >
                      <HugeiconsIcon icon={RepeatIcon} strokeWidth={1.5} />
                    </SidebarMenuAction>
                    <SidebarMenuAction
                      showOnHover
                      aria-label={`Remove ${file.name}`}
                      disabled={isBusy}
                      onClick={() => setRemoval({ kind: "file", file })}
                    >
                      <HugeiconsIcon icon={Cancel01Icon} strokeWidth={1.5} />
                    </SidebarMenuAction>
                  </SidebarMenuItem>
                ))}
                {project.connections.flatMap((connection) =>
                  connection.tables.map((table) => {
                    const label = tableLabel(connection, table)
                    return (
                      <SidebarMenuItem key={`${connection.id}/${label}`}>
                        <SidebarMenuButton
                          title={`${label}, live from ${connection.host}`}
                          isActive={view === "data" && label === activeFile}
                          onClick={() => onOpenDatabaseTable(connection, table)}
                        >
                          <DatabaseIcon kind={connection.kind} />
                          <span className="truncate">{label}</span>
                        </SidebarMenuButton>
                        <SidebarMenuAction
                          showOnHover
                          aria-label={`Remove ${label}`}
                          disabled={isBusy}
                          onClick={() =>
                            setRemoval({ kind: "table", connection, table })
                          }
                        >
                          <HugeiconsIcon
                            icon={Cancel01Icon}
                            strokeWidth={1.5}
                          />
                        </SidebarMenuAction>
                      </SidebarMenuItem>
                    )
                  })
                )}
              </SidebarMenu>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupLabel>Chats</SidebarGroupLabel>
              <SidebarGroupAction
                aria-label="New chat"
                disabled={isBusy}
                onClick={onNewChat}
              >
                <HugeiconsIcon icon={Add01Icon} strokeWidth={1.5} />
              </SidebarGroupAction>
              <SidebarMenu className="gap-0">
                {project.chats.map((chat) => (
                  <SidebarMenuItem key={chat.id}>
                    <SidebarMenuButton
                      title={chat.title}
                      disabled={isBusy}
                      isActive={chat.id === activeChat}
                      onClick={() => onOpenChat(chat)}
                    >
                      {isBusy && chat.id === activeChat ? (
                        <span
                          aria-label="Working"
                          className="mx-1 size-1.5 shrink-0 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
                        />
                      ) : (
                        <HugeiconsIcon icon={Message01Icon} strokeWidth={1.5} />
                      )}
                      <span className="truncate">{chat.title}</span>
                    </SidebarMenuButton>
                    <SidebarMenuAction
                      showOnHover
                      aria-label={`Delete ${chat.title}`}
                      disabled={isBusy}
                      onClick={() => setRemoval({ kind: "chat", chat })}
                    >
                      <HugeiconsIcon icon={Cancel01Icon} strokeWidth={1.5} />
                    </SidebarMenuAction>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>
      <SidebarFooter className="flex-row items-center gap-1">
        <SidebarMenu className="min-w-0 flex-1">
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={view === "settings"}
              onClick={() => onViewChange("settings")}
            >
              <HugeiconsIcon icon={Settings01Icon} strokeWidth={1.5} />
              {VIEW_LABELS.settings}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SoundToggle />
      </SidebarFooter>
      {removal?.kind === "file" && (
        <ConfirmRemoval
          title={`Remove ${removal.file.name}?`}
          description="Davis deletes its copy from this project. Your original file isn't touched, but charts and answers built on this file may stop working."
          action="Remove file"
          onConfirm={() => onRemoveFile(removal.file)}
          onClose={() => setRemoval(undefined)}
        />
      )}
      {removal?.kind === "table" && (
        <ConfirmRemoval
          title={`Remove ${tableLabel(removal.connection, removal.table)}?`}
          description="Davis stops showing this table. Nothing changes in the database, but charts and answers built on it may stop working."
          action="Remove table"
          onConfirm={() =>
            onRemoveDatabaseTable(removal.connection, removal.table)
          }
          onClose={() => setRemoval(undefined)}
        />
      )}
      {removal?.kind === "page" && (
        <ConfirmRemoval
          title="Delete this Page?"
          description={`${removal.page.title} will be deleted for good. The data and chats it came from stay in the project.`}
          action="Delete Page"
          onConfirm={() => onDeletePage(removal.page)}
          onClose={() => setRemoval(undefined)}
        />
      )}
      {removal?.kind === "chat" && (
        <ConfirmRemoval
          title="Delete this chat?"
          description={`${removal.chat.title} will be deleted for good.`}
          action="Delete chat"
          onConfirm={() => onDeleteChat(removal.chat)}
          onClose={() => setRemoval(undefined)}
        />
      )}
    </Sidebar>
  )
}
