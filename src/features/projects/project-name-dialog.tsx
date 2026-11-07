import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { toErrorMessage } from "@/lib/ipc-error"

type ProjectNameDialogProps = {
  title: string
  action: string
  initialName?: string
  onSave: (name: string) => Promise<unknown>
  onClose: () => void
}

export function ProjectNameDialog({
  title,
  action,
  initialName = "",
  onSave,
  onClose,
}: ProjectNameDialogProps) {
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string>()
  const [isSaving, setIsSaving] = useState(false)

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setIsSaving(true)
    setError(undefined)
    try {
      await onSave(name)
      onClose()
    } catch (failure) {
      setError(toErrorMessage(failure))
      setIsSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-80">
        <form className="flex flex-col gap-4" onSubmit={(e) => void save(e)}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <Field data-invalid={Boolean(error) || undefined}>
            <FieldLabel htmlFor="project-name">Name</FieldLabel>
            <Input
              id="project-name"
              autoFocus
              value={name}
              aria-invalid={Boolean(error) || undefined}
              onChange={(event) => setName(event.target.value)}
            />
            {error && <FieldError>{error}</FieldError>}
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || isSaving}>
              {action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
