import { open as chooseFile } from "@tauri-apps/plugin-dialog"
import { useCallback, useState } from "react"

import { openTable, type OpenedTable } from "@/features/data/api"
import { toErrorMessage } from "@/lib/ipc-error"

const EXTENSIONS = [
  "csv",
  "tsv",
  "txt",
  "gz",
  "xlsx",
  "xlsm",
  "xlsb",
  "xls",
  "ods",
  "parquet",
  "json",
  "jsonl",
]

export function fileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path
}

export async function chooseFiles() {
  const paths = await chooseFile({
    multiple: true,
    filters: [{ name: "Data files", extensions: EXTENSIONS }],
  })
  return paths ?? []
}

export async function chooseReplacement(name: string) {
  return chooseFile({
    filters: [
      { name: "Data files", extensions: [name.split(".").pop() ?? ""] },
    ],
  })
}

export function useOpenTable() {
  const [table, setTable] = useState<OpenedTable>()
  const [openingName, setOpeningName] = useState<string>()
  const [error, setError] = useState<string>()

  const load = useCallback(
    async (name: string, read: () => Promise<OpenedTable>) => {
      setOpeningName(name)
      setError(undefined)
      try {
        setTable(await read())
        return true
      } catch (failure) {
        setError(toErrorMessage(failure))
        return false
      } finally {
        setOpeningName(undefined)
      }
    },
    []
  )

  const open = useCallback(
    (path: string) => load(fileName(path), () => openTable(path)),
    [load]
  )

  const close = useCallback(() => {
    setTable(undefined)
    setError(undefined)
  }, [])

  return { table, openingName, error, load, open, close }
}
