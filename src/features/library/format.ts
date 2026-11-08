import type { Category } from "@/features/library/api"

export const CATEGORIES: { value: Category; label: string }[] = [
  { value: "business", label: "Business" },
  { value: "world", label: "World" },
  { value: "climate", label: "Climate" },
  { value: "energy", label: "Energy" },
  { value: "transport", label: "Transport" },
  { value: "nature", label: "Nature" },
  { value: "technology", label: "Technology" },
  { value: "sports", label: "Sports" },
]

const MEGABYTE = 1_000_000
const KILOBYTE = 1_000

// Publishers change their files, so a size is only ever "about".
export function aboutSize(bytes: number) {
  if (bytes >= MEGABYTE) return `about ${Math.round(bytes / MEGABYTE)} MB`
  return `about ${Math.max(1, Math.round(bytes / KILOBYTE))} KB`
}
