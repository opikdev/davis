import {
  ArrowDown01Icon,
  Folder01Icon,
  FolderAddIcon,
  FolderOpenIcon,
  PencilEdit02Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { open as chooseFolder } from "@tauri-apps/plugin-dialog"
import { revealItemInDir } from "@tauri-apps/plugin-opener"
import { useState } from "react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarMenuButton } from "@/components/ui/sidebar"
import type { Project, RecentProject } from "@/features/projects/api"
import { ProjectNameDialog } from "@/features/projects/project-name-dialog"

type ProjectSwitcherProps = {
  project?: Project
  recent: RecentProject[]
  isBusy: boolean
  onOpen: (path: string) => void
  onCreate: (name: string) => Promise<unknown>
  onRename: (name: string) => Promise<unknown>
}

export function ProjectSwitcher({
  project,
  recent,
  isBusy,
  onOpen,
  onCreate,
  onRename,
}: ProjectSwitcherProps) {
  const [dialog, setDialog] = useState<"create" | "rename">()
  const others = recent.filter(({ path }) => path !== project?.path)

  async function browseForProject() {
    const folder = await chooseFolder({ directory: true })
    if (folder) onOpen(folder)
  }

  function revealProject() {
    if (!project) return
    revealItemInDir(project.path).catch((error: unknown) =>
      console.error("Could not show the project folder", error)
    )
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={isBusy}
          render={
            <SidebarMenuButton aria-label="Choose a project">
              <HugeiconsIcon icon={Folder01Icon} strokeWidth={1.5} />
              <span className="truncate">{project?.name ?? "No project"}</span>
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                strokeWidth={1.5}
                className="ml-auto size-3! text-subtle"
              />
            </SidebarMenuButton>
          }
        />
        <DropdownMenuContent className="min-w-52">
          {project && (
            <DropdownMenuItem disabled>
              <HugeiconsIcon icon={Tick02Icon} strokeWidth={1.5} />
              <span className="truncate">{project.name}</span>
            </DropdownMenuItem>
          )}
          {others.length > 0 && (
            <DropdownMenuGroup>
              <DropdownMenuLabel>Recent</DropdownMenuLabel>
              {others.map(({ path, name }) => (
                <DropdownMenuItem key={path} onClick={() => onOpen(path)}>
                  <HugeiconsIcon icon={Folder01Icon} strokeWidth={1.5} />
                  <span className="truncate">{name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          )}
          {(project || others.length > 0) && <DropdownMenuSeparator />}
          <DropdownMenuItem onClick={() => setDialog("create")}>
            <HugeiconsIcon icon={FolderAddIcon} strokeWidth={1.5} />
            New project
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void browseForProject()}>
            <HugeiconsIcon icon={FolderOpenIcon} strokeWidth={1.5} />
            Open project
          </DropdownMenuItem>
          {project && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setDialog("rename")}>
                <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={1.5} />
                Rename project
              </DropdownMenuItem>
              <DropdownMenuItem onClick={revealProject}>
                <HugeiconsIcon icon={FolderOpenIcon} strokeWidth={1.5} />
                Show in folder
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog === "create" && (
        <ProjectNameDialog
          title="New project"
          action="Create project"
          onSave={onCreate}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog === "rename" && project && (
        <ProjectNameDialog
          title="Rename project"
          action="Rename project"
          initialName={project.name}
          onSave={onRename}
          onClose={() => setDialog(undefined)}
        />
      )}
    </>
  )
}
