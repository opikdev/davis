import { useEffect, useState } from "react"

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { filterChoices, type FilterChoice } from "@/features/pages/api"
import { toErrorMessage } from "@/lib/ipc-error"

type AddFilterDialogProps = {
  project: string
  onChoose: (table: string, column: string) => void
  onClose: () => void
}

export function AddFilterDialog({
  project,
  onChoose,
  onClose,
}: AddFilterDialogProps) {
  const [choices, setChoices] = useState<FilterChoice[]>([])
  const [error, setError] = useState<string>()

  useEffect(() => {
    filterChoices(project)
      .then(setChoices)
      .catch((failure: unknown) => setError(toErrorMessage(failure)))
  }, [project])

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="gap-3 sm:max-w-80">
        <DialogHeader>
          <DialogTitle>Filter this Page by</DialogTitle>
        </DialogHeader>
        {error ? (
          <p className="text-destructive">{error}</p>
        ) : (
          <Command className="bg-transparent p-0">
            <CommandInput placeholder="Find a column" />
            <CommandList className="max-h-64">
              <CommandEmpty>No columns found.</CommandEmpty>
              {choices.map(({ table, columns }) => (
                <CommandGroup key={table} heading={table}>
                  {columns.map((column) => (
                    <CommandItem
                      key={column}
                      value={`${table} ${column}`}
                      onSelect={() => onChoose(table, column)}
                    >
                      {column}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        )}
      </DialogContent>
    </Dialog>
  )
}
