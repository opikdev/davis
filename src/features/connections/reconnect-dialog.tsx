import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  reconnectDatabase,
  type DatabaseConnection,
} from "@/features/connections/api"
import type { Project } from "@/features/projects"
import { toErrorMessage } from "@/lib/ipc-error"

type ReconnectDialogProps = {
  project: string
  connection: DatabaseConnection
  onReconnected: (project: Project) => void
  onClose: () => void
}

export function ReconnectDialog({
  project,
  connection,
  onReconnected,
  onClose,
}: ReconnectDialogProps) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string>()
  const [isWorking, setIsWorking] = useState(false)

  async function reconnect(event: React.FormEvent) {
    event.preventDefault()
    setIsWorking(true)
    setError(undefined)
    try {
      onReconnected(await reconnectDatabase(project, connection.id, password))
    } catch (failure) {
      setError(toErrorMessage(failure))
      setIsWorking(false)
    }
  }

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-80">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => void reconnect(e)}
        >
          <DialogHeader>
            <DialogTitle>Reconnect {connection.name}</DialogTitle>
            <DialogDescription>
              Enter the password for {connection.user} on {connection.host}.
              Davis keeps it in your system keychain.
            </DialogDescription>
          </DialogHeader>
          <Field data-invalid={Boolean(error) || undefined}>
            <FieldLabel htmlFor="reconnect-password">Password</FieldLabel>
            <Input
              id="reconnect-password"
              type="password"
              autoFocus
              autoComplete="off"
              value={password}
              aria-invalid={Boolean(error) || undefined}
              onChange={(event) => setPassword(event.target.value)}
            />
            {error && <FieldError>{error}</FieldError>}
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isWorking}>
              {isWorking && <Spinner data-icon="inline-start" />}
              Reconnect
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
