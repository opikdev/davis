import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  addDatabase,
  databaseSupport,
  installDatabaseSupport,
  testDatabase,
  type ConnectedTable,
  type DatabaseKind,
  type DatabaseLogin,
  type DatabaseTableInfo,
  type SslMode,
} from "@/features/connections/api"
import type { Project } from "@/features/projects"
import { toErrorMessage } from "@/lib/ipc-error"

const KINDS: { value: DatabaseKind; label: string; port: number }[] = [
  { value: "postgres", label: "Postgres", port: 5432 },
  { value: "mysql", label: "MySQL", port: 3306 },
]
const SSL_OPTIONS: { value: SslMode; label: string }[] = [
  { value: "prefer", label: "Use if the server has it" },
  { value: "require", label: "Always" },
  { value: "disable", label: "Never" },
]

// Host, database and user names are case-sensitive, so the system mustn't
// capitalize or correct them.
const EXACT_TEXT = {
  autoCapitalize: "none",
  autoCorrect: "off",
  spellCheck: false,
} as const

type Step = "details" | "download" | "tables"

function kindOf(value: DatabaseKind) {
  return KINDS.find((kind) => kind.value === value) ?? KINDS[0]
}

type ConnectDatabaseDialogProps = {
  project: Project
  onAdded: (project: Project, connectionId: string) => void
  onClose: () => void
}

function key({ schema, table }: ConnectedTable) {
  return `${schema}.${table}`
}

function freeName(project: Project, database: string) {
  const taken = new Set(project.connections.map(({ name }) => name))
  let name = database
  for (let number = 2; taken.has(name); number += 1) {
    name = `${database} ${number}`
  }
  return name
}

export function ConnectDatabaseDialog({
  project,
  onAdded,
  onClose,
}: ConnectDatabaseDialogProps) {
  const [step, setStep] = useState<Step>("details")
  const [login, setLogin] = useState<DatabaseLogin>({
    kind: "postgres",
    host: "",
    port: KINDS[0].port,
    database: "",
    user: "",
    password: "",
    ssl: "prefer",
  })
  const [tables, setTables] = useState<DatabaseTableInfo[]>([])
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string>()
  const [isWorking, setIsWorking] = useState(false)

  const kind = kindOf(login.kind)

  async function work(task: () => Promise<void>) {
    setIsWorking(true)
    setError(undefined)
    try {
      await task()
    } catch (failure) {
      setError(toErrorMessage(failure))
    } finally {
      setIsWorking(false)
    }
  }

  async function findTables() {
    const found = await testDatabase(login)
    setTables(found)
    setChosen(new Set())
    setStep("tables")
  }

  const download = () =>
    work(async () => {
      await installDatabaseSupport(login.kind)
      await findTables()
    })

  // Support for each kind of database is a separate one-time download.
  const test = (event: React.FormEvent) => {
    event.preventDefault()
    return work(async () => {
      if (await databaseSupport(login.kind)) {
        await findTables()
      } else {
        setStep("download")
      }
    })
  }

  const add = () =>
    work(async () => {
      const picked = tables
        .filter((table) => chosen.has(key(table)))
        .map(({ schema, table }) => ({ schema, table }))
      const id = crypto.randomUUID()
      const updated = await addDatabase(
        project.path,
        {
          id,
          kind: login.kind,
          name: freeName(project, login.database.trim()),
          host: login.host.trim(),
          port: login.port,
          database: login.database.trim(),
          user: login.user.trim(),
          ssl: login.ssl,
          tables: picked,
        },
        login.password
      )
      onAdded(updated, id)
    })

  function toggle(table: DatabaseTableInfo, isChecked: boolean) {
    const next = new Set(chosen)
    if (isChecked) next.add(key(table))
    else next.delete(key(table))
    setChosen(next)
  }

  function change<Key extends keyof DatabaseLogin>(
    field: Key,
    value: DatabaseLogin[Key]
  ) {
    setLogin({ ...login, [field]: value })
  }

  function changeKind(next: DatabaseKind) {
    const isDefaultPort = KINDS.some(({ port }) => port === login.port)
    setLogin({
      ...login,
      kind: next,
      port: isDefaultPort ? kindOf(next).port : login.port,
    })
  }

  const isComplete =
    login.host.trim() !== "" &&
    login.database.trim() !== "" &&
    login.user.trim() !== "" &&
    Number.isInteger(login.port) &&
    login.port > 0

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect a database</DialogTitle>
          <DialogDescription>
            Charts and answers read the database live. Davis only reads, and a
            read-only database user is safest.
          </DialogDescription>
        </DialogHeader>

        {step === "download" && (
          <>
            <p className="text-sm">
              Davis needs {kind.label} support first. It&apos;s a one-time
              download of about 45 MB from DuckDB, the engine Davis runs on.
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep("details")}
              >
                Back
              </Button>
              <Button
                type="button"
                disabled={isWorking}
                onClick={() => void download()}
              >
                {isWorking && <Spinner data-icon="inline-start" />}
                {isWorking ? "Downloading" : "Download"}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "details" && (
          <form className="flex flex-col gap-4" onSubmit={(e) => void test(e)}>
            <FieldGroup className="gap-3">
              <Field>
                <FieldLabel id="database-kind">Type</FieldLabel>
                <ToggleGroup
                  aria-labelledby="database-kind"
                  value={[login.kind]}
                  onValueChange={(next: string[]) => {
                    const picked = next[0] as DatabaseKind | undefined
                    if (picked) changeKind(picked)
                  }}
                  className="justify-start"
                >
                  {KINDS.map(({ value, label }) => (
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
              </Field>
              <div className="grid grid-cols-[1fr_6rem] gap-3">
                <Field>
                  <FieldLabel htmlFor="database-host">Host</FieldLabel>
                  <Input
                    id="database-host"
                    {...EXACT_TEXT}
                    autoFocus
                    placeholder="db.example.com"
                    value={login.host}
                    onChange={(event) => change("host", event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="database-port">Port</FieldLabel>
                  <Input
                    id="database-port"
                    {...EXACT_TEXT}
                    inputMode="numeric"
                    value={String(login.port)}
                    onChange={(event) =>
                      change("port", Number(event.target.value))
                    }
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="database-name">Database</FieldLabel>
                <Input
                  id="database-name"
                  {...EXACT_TEXT}
                  value={login.database}
                  onChange={(event) => change("database", event.target.value)}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="database-user">User</FieldLabel>
                  <Input
                    id="database-user"
                    {...EXACT_TEXT}
                    autoComplete="off"
                    value={login.user}
                    onChange={(event) => change("user", event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="database-password">Password</FieldLabel>
                  <Input
                    id="database-password"
                    type="password"
                    autoComplete="off"
                    value={login.password}
                    onChange={(event) => change("password", event.target.value)}
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="database-ssl">Encryption (SSL)</FieldLabel>
                <Select
                  value={login.ssl}
                  items={SSL_OPTIONS}
                  onValueChange={(next) => {
                    if (next !== null) change("ssl", next)
                  }}
                >
                  <SelectTrigger id="database-ssl" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SSL_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  The password is kept in your system keychain, not in the
                  project folder.
                </FieldDescription>
              </Field>
            </FieldGroup>
            {error && <FieldError>{error}</FieldError>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!isComplete || isWorking}>
                {isWorking && <Spinner data-icon="inline-start" />}
                Test connection
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === "tables" && (
          <>
            {tables.length === 0 ? (
              <p className="text-sm">
                Connected, but this user can&apos;t see any tables. Ask whoever
                runs the database to give it read access.
              </p>
            ) : (
              <fieldset className="flex max-h-72 flex-col gap-1 overflow-y-auto">
                <legend className="mb-2 text-sm">
                  Connected to {login.database}. Pick the tables to add.
                </legend>
                {tables.map((table) => {
                  const id = `database-table-${key(table)}`
                  return (
                    <label
                      key={key(table)}
                      htmlFor={id}
                      className="flex items-center gap-2 rounded-md px-1 py-1.5 text-sm hover:bg-muted"
                    >
                      <Checkbox
                        id={id}
                        checked={chosen.has(key(table))}
                        onCheckedChange={(isChecked) =>
                          toggle(table, isChecked)
                        }
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {table.schema === "public" ||
                        table.schema === login.database.trim()
                          ? table.table
                          : key(table)}
                      </span>
                      {Boolean(table.estimatedRows) && (
                        <span className="text-xs text-subtle tabular-nums">
                          about {table.estimatedRows?.toLocaleString()} rows
                        </span>
                      )}
                    </label>
                  )
                })}
              </fieldset>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep("details")}
              >
                Back
              </Button>
              <Button
                type="button"
                disabled={chosen.size === 0 || isWorking}
                onClick={() => void add()}
              >
                {isWorking && <Spinner data-icon="inline-start" />}
                {chosen.size === 1
                  ? "Add 1 table"
                  : `Add ${chosen.size} tables`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
