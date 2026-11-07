import {
  Add01Icon,
  Cancel01Icon,
  DashboardSquare01Icon,
  File02Icon,
  Home01Icon,
  Message01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { useState } from "react"

import { DavisMark } from "@/components/davis-mark"
import { SoundToggle } from "@/components/sound-toggle"
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
  ConfirmRemoval,
  ProjectSwitcher,
  type ChatSummary,
  type ProjectFile,
} from "@/features/projects"

export type View = "home" | "data" | "pages" | "settings"

export const VIEW_LABELS: Record<View, string> = {
  home: "Home",
  data: "Data",
  pages: "Pages",
  settings: "Settings",
}

const MAIN_ITEMS: { view: View; icon: IconSvgElement }[] = [
  { view: "home", icon: Home01Icon },
  { view: "pages", icon: DashboardSquare01Icon },
]

type Removal =
  { kind: "file"; file: ProjectFile } | { kind: "chat"; chat: ChatSummary }

type AppSidebarProps = Pick<
  React.ComponentProps<typeof ProjectSwitcher>,
  "project" | "recent" | "isBusy" | "onOpen" | "onCreate" | "onRename"
> & {
  view: View
  activeFile?: string
  activeChat?: string
  onViewChange: (view: View) => void
  onAddFiles: () => void
  onOpenFile: (file: ProjectFile) => void
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
  onViewChange,
  onAddFiles,
  onOpenFile,
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
              <SidebarGroupLabel>Data</SidebarGroupLabel>
              <SidebarGroupAction aria-label="Add files" onClick={onAddFiles}>
                <HugeiconsIcon icon={Add01Icon} strokeWidth={1.5} />
              </SidebarGroupAction>
              <SidebarMenu className="gap-0">
                {project.files.map((file) => (
                  <SidebarMenuItem key={file.path}>
                    <SidebarMenuButton
                      title={file.name}
                      isActive={view === "data" && file.name === activeFile}
                      onClick={() => onOpenFile(file)}
                    >
                      <HugeiconsIcon icon={File02Icon} strokeWidth={1.5} />
                      <span className="truncate">{file.name}</span>
                    </SidebarMenuButton>
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
