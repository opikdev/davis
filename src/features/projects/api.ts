import { invoke } from "@tauri-apps/api/core"

import type { OpenedTable } from "@/features/data"

export type ProjectFile = {
  name: string
  path: string
  sizeBytes: number
}

export type ChatSummary = {
  id: string
  title: string
  updatedAt: number
}

export type Project = {
  path: string
  name: string
  files: ProjectFile[]
  chats: ChatSummary[]
}

export type RecentProject = {
  path: string
  name: string
}

export function lastProject() {
  return invoke<Project | null>("last_project")
}

export function recentProjects() {
  return invoke<RecentProject[]>("recent_projects")
}

export function openProject(path: string) {
  return invoke<Project>("open_project", { path })
}

export function createProject(name: string) {
  return invoke<Project>("create_project", { name })
}

export function renameProject(path: string, name: string) {
  return invoke<Project>("rename_project", { path, name })
}

export function addProjectFile(project: string, path: string) {
  return invoke<OpenedTable>("add_project_file", { project, path })
}

export function removeProjectFile(project: string, name: string) {
  return invoke<void>("remove_project_file", { project, name })
}
