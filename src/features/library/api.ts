import { Channel, invoke } from "@tauri-apps/api/core"

import type { Project } from "@/features/projects"

export type Category =
  | "business"
  | "world"
  | "climate"
  | "energy"
  | "transport"
  | "nature"
  | "technology"
  | "sports"

export type Dataset = {
  id: string
  title: string
  category: Category
  summary: string
  covers: string
  publisher: string
  sourceUrl: string
  license: { name: string; url: string }
  credit: string
  sizeBytes: number
  isFeatured: boolean
  isLive: boolean
  isAdvanced: boolean
  questions: string[]
}

export type ImportProgress = {
  label: string
  received: number
  total: number | null
}

export type ImportedDataset = {
  project: Project
  files: string[]
  pageId: string | null
}

export function libraryDatasets() {
  return invoke<Dataset[]>("library_datasets")
}

export function importDataset(
  project: string | null,
  id: string,
  onProgress: (progress: ImportProgress) => void
) {
  const progress = new Channel<ImportProgress>()
  progress.onmessage = onProgress
  return invoke<ImportedDataset>("import_dataset", {
    project,
    id,
    onProgress: progress,
  })
}
