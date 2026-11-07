import { useCallback, useState } from "react"

import {
  createProject,
  lastProject,
  openProject,
  recentProjects,
  renameProject,
  type Project,
  type RecentProject,
} from "@/features/projects/api"

export function useProject() {
  const [project, setProject] = useState<Project>()
  const [recent, setRecent] = useState<RecentProject[]>([])

  const show = useCallback(async (next: Project) => {
    setProject(next)
    setRecent(await recentProjects())
    return next
  }, [])

  const loadLast = useCallback(async () => {
    const [last, known] = await Promise.all([lastProject(), recentProjects()])
    setProject(last ?? undefined)
    setRecent(known)
    return last
  }, [])

  const open = useCallback(
    async (path: string) => show(await openProject(path)),
    [show]
  )
  const create = useCallback(
    async (name: string) => show(await createProject(name)),
    [show]
  )
  const rename = useCallback(
    async (path: string, name: string) => show(await renameProject(path, name)),
    [show]
  )
  const refresh = useCallback(async (path: string) => {
    setProject(await openProject(path))
  }, [])

  return { project, recent, loadLast, open, create, rename, refresh }
}
