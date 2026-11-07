import { open as chooseFile } from "@tauri-apps/plugin-dialog"
import { useCallback, useState } from "react"

import { openTable, type OpenedTable } from "@/features/data/api"
import { toErrorMessage } from "@/lib/ipc-error"

const EXTENSIONS = ["csv", "tsv", "txt", "gz", "parquet", "json", "jsonl"]

function fileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path
}

export function useOpenTable() {
  const [table, setTable] = useState<OpenedTable>()
  const [openingName, setOpeningName] = useState<string>()
  const [error, setError] = useState<string>()

  const open = useCallback(async (path: string) => {
    setOpeningName(fileName(path))
    setError(undefined)
    try {
      const opened = await openTable(path)
      setTable(opened)
      return true
    } catch (failure) {
      setError(toErrorMessage(failure))
      return false
    } finally {
      setOpeningName(undefined)
    }
  }, [])

  const browse = useCallback(async () => {
    const path = await chooseFile({
      multiple: false,
      filters: [{ name: "Data files", extensions: EXTENSIONS }],
    })
    return path ? open(path) : undefined
  }, [open])

  return { table, openingName, error, open, browse }
}
