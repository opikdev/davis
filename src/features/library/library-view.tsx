import { Search01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  libraryDatasets,
  type Category,
  type Dataset,
  type ImportedDataset,
} from "@/features/library/api"
import { DatasetSheet } from "@/features/library/dataset-sheet"
import { aboutSize, CATEGORIES } from "@/features/library/format"
import type { Project } from "@/features/projects"
import { toErrorMessage } from "@/lib/ipc-error"

type LibraryViewProps = {
  project?: Project
  openDatasetId?: string
  onImported: (imported: ImportedDataset) => void
}

function matchesSearch(dataset: Dataset, search: string) {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  const text = [dataset.title, dataset.summary, dataset.publisher]
    .join(" ")
    .toLowerCase()
  return words.every((word) => text.includes(word))
}

function DatasetItem({
  dataset,
  onOpen,
}: {
  dataset: Dataset
  onOpen: () => void
}) {
  return (
    <Item
      variant="outline"
      render={<button type="button" onClick={onOpen} />}
      className="cursor-pointer text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <ItemContent>
        <ItemTitle>
          {dataset.title}
          {dataset.isLive && <Badge variant="secondary">Live</Badge>}
          {dataset.isAdvanced && <Badge variant="outline">Advanced</Badge>}
        </ItemTitle>
        <ItemDescription className="line-clamp-2">
          {dataset.summary}
        </ItemDescription>
        <p className="text-xs text-subtle">
          {dataset.publisher} · {dataset.covers} ·{" "}
          {aboutSize(dataset.sizeBytes)}
        </p>
      </ItemContent>
    </Item>
  )
}

export function LibraryView({
  project,
  openDatasetId,
  onImported,
}: LibraryViewProps) {
  const [datasets, setDatasets] = useState<Dataset[]>()
  const [error, setError] = useState<string>()
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState<Category>()
  const [openId, setOpenId] = useState(openDatasetId)
  const [isOpen, setIsOpen] = useState(Boolean(openDatasetId))

  useEffect(() => {
    libraryDatasets()
      .then(setDatasets)
      .catch((failure: unknown) => setError(toErrorMessage(failure)))
  }, [])

  const shown = (datasets ?? []).filter(
    (dataset) =>
      (!category || dataset.category === category) &&
      matchesSearch(dataset, search)
  )
  const isBrowsing = !category && !search.trim()
  const featured = shown.filter((dataset) => dataset.isFeatured)
  const opened = datasets?.find((dataset) => dataset.id === openId)

  const list = (items: Dataset[]) => (
    <ItemGroup className="gap-2">
      {items.map((dataset) => (
        <DatasetItem
          key={dataset.id}
          dataset={dataset}
          onOpen={() => {
            setOpenId(dataset.id)
            setIsOpen(true)
          }}
        />
      ))}
    </ItemGroup>
  )

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-medium">Library</h1>
        <p className="text-sm text-muted-foreground">
          Real public data to explore, downloaded straight from each publisher.
        </p>
      </header>
      <div className="flex flex-col gap-3">
        <InputGroup>
          <InputGroupAddon>
            <HugeiconsIcon icon={Search01Icon} strokeWidth={1.5} />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search the library"
            placeholder="Search datasets"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </InputGroup>
        <ToggleGroup
          aria-label="Category"
          value={category ? [category] : []}
          onValueChange={(next: string[]) =>
            setCategory(next[0] as Category | undefined)
          }
          className="flex-wrap justify-start"
        >
          {CATEGORIES.map(({ value, label }) => (
            <ToggleGroupItem
              key={value}
              value={value}
              size="sm"
              variant="outline"
            >
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!datasets && !error && <Skeleton className="h-40" />}
      {datasets && shown.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing matches. Try another word or category.
        </p>
      )}
      {isBrowsing && featured.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-medium text-subtle">
            Start here: small and quick
          </h2>
          {list(featured)}
        </section>
      )}
      {isBrowsing
        ? CATEGORIES.map(({ value, label }) => {
            const inCategory = shown.filter(
              (dataset) => dataset.category === value && !dataset.isFeatured
            )
            return (
              inCategory.length > 0 && (
                <section key={value} className="flex flex-col gap-2">
                  <h2 className="text-xs font-medium text-subtle">{label}</h2>
                  {list(inCategory)}
                </section>
              )
            )
          })
        : shown.length > 0 && list(shown)}
      <DatasetSheet
        dataset={opened}
        isOpen={isOpen}
        project={project}
        onImported={(imported) => {
          setIsOpen(false)
          onImported(imported)
        }}
        onClose={() => setIsOpen(false)}
        onClosed={() => setOpenId(undefined)}
      />
    </div>
  )
}
