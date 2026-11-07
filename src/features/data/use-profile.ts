import { useEffect, useState } from "react"

import {
  profileTable,
  type ColumnProfile,
  type TableSource,
} from "@/features/data/api"

type Loaded = {
  path: string
  profile: ColumnProfile[]
}

export function useProfile(source: TableSource | undefined) {
  const [loaded, setLoaded] = useState<Loaded>()

  useEffect(() => {
    if (!source) return
    let isCurrent = true
    profileTable(source)
      .then((profile) => {
        if (isCurrent) setLoaded({ path: source.path, profile })
      })
      .catch((error: unknown) =>
        console.error("Could not profile the table", error)
      )
    return () => {
      isCurrent = false
    }
  }, [source])

  return loaded && loaded.path === source?.path ? loaded.profile : undefined
}
