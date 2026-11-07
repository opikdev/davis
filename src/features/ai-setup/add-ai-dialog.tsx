import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useRef, useState, type CSSProperties } from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Button } from "@/components/ui/button"
import type { ConnectionRequest } from "@/features/ai-setup/api"
import {
  providerById,
  providersInGroup,
  type Provider,
  type ProviderGroup,
} from "@/features/ai-setup/catalog"
import { ConnectForm } from "@/features/ai-setup/connect-form"
import type { ConnectFailure } from "@/features/ai-setup/failure-message"
import { playSound } from "@/lib/sound/player"
import { ProviderList } from "@/features/ai-setup/provider-list"

const GROUPS: { group: ProviderGroup; label: string }[] = [
  { group: "app", label: "AI tools" },
  { group: "api-key", label: "API keys" },
  { group: "local", label: "Local models" },
  { group: "router", label: "Gateways" },
]

type Form = { provider: Provider; failure?: ConnectFailure }

type AddAiDialogProps = {
  initialGroup?: ProviderGroup
  initialForm?: Form
  isFound: (provider: Provider) => boolean
  renderRow: (
    provider: Provider,
    onNeedsForm: (failure?: ConnectFailure) => void
  ) => React.ReactNode
  onConnect: (
    provider: Provider,
    request: Omit<ConnectionRequest, "providerId">
  ) => Promise<ConnectFailure | undefined>
  onFormExit: (provider: Provider) => void
  onClose: () => void
}

function matches(provider: Provider, query: string) {
  return provider.name.toLowerCase().includes(query.trim().toLowerCase())
}

export function AddAiDialog({
  initialGroup,
  initialForm,
  isFound,
  renderRow,
  onConnect,
  onFormExit,
  onClose,
}: AddAiDialogProps) {
  const [query, setQuery] = useState("")
  const [form, setForm] = useState(initialForm)
  const [isOpen, setIsOpen] = useState(true)
  const [viewFrom, setViewFrom] = useState("0px")
  const searchInput = useRef<HTMLInputElement>(null)
  const view = useRef<HTMLDivElement>(null)
  const opener = useRef(document.activeElement)
  const customUrl = providerById("custom")

  useEffect(() => {
    if (viewFrom !== "0px") view.current?.querySelector("input")?.focus()
  }, [form, viewFrom])

  function openForm(next: Form) {
    setViewFrom("16px")
    setForm(next)
  }

  function leaveForm() {
    if (form) onFormExit(form.provider)
    setViewFrom("-16px")
    setForm(undefined)
  }

  const groups = GROUPS.filter(
    ({ group }) => !initialGroup || group === initialGroup
  ).flatMap(({ group, label }) => {
    const providers = providersInGroup(group)
      .filter((provider) => matches(provider, query))
      .sort((a, b) => Number(isFound(b)) - Number(isFound(a)))
    return providers.length > 0 ? [{ group, label, providers }] : []
  })

  const resultCount = groups.reduce(
    (count, { providers }) => count + providers.length,
    0
  )

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (open) return
        if (form) onFormExit(form.provider)
        playSound("close")
        setIsOpen(false)
      }}
      onOpenChangeComplete={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className="gap-4 p-5 sm:max-w-md"
        initialFocus={() => view.current?.querySelector("input") ?? true}
        finalFocus={() =>
          opener.current?.isConnected
            ? true
            : document.querySelector<HTMLElement>("h1")
        }
      >
        <DialogHeader>
          <DialogTitle>
            <span key={form?.provider.id} className="block animate-fade">
              {form
                ? `Connect ${form.provider.connectLabel ?? form.provider.name}`
                : "Add an AI"}
            </span>
          </DialogTitle>
          <DialogDescription className="sr-only">
            {form
              ? `Enter the details to connect ${form.provider.name}.`
              : "Search for the AI you want to connect."}
          </DialogDescription>
        </DialogHeader>
        <div
          key={form ? "form" : "list"}
          ref={view}
          className="grid h-109 animate-step grid-rows-[auto_minmax(0,1fr)] gap-4"
          style={{ "--step-from": viewFrom } as CSSProperties}
        >
          {form ? (
            <div className="row-span-2 no-scrollbar min-h-0 overflow-y-auto">
              <ConnectForm
                key={form.provider.id}
                provider={form.provider}
                initialFailure={form.failure}
                onConnect={(request) => onConnect(form.provider, request)}
                onDone={() => setIsOpen(false)}
                onBack={leaveForm}
              />
            </div>
          ) : (
            <>
              <InputGroup>
                <InputGroupAddon>
                  <HugeiconsIcon icon={Search01Icon} strokeWidth={1.5} />
                </InputGroupAddon>
                <InputGroupInput
                  ref={searchInput}
                  aria-label="Search for an AI"
                  placeholder="Search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  spellCheck={false}
                  autoCorrect="off"
                />
                {query && (
                  <InputGroupAddon align="inline-end" className="animate-pop">
                    <InputGroupButton
                      size="icon-sm"
                      aria-label="Clear search"
                      onClick={() => {
                        setQuery("")
                        searchInput.current?.focus()
                      }}
                    >
                      <HugeiconsIcon icon={Cancel01Icon} strokeWidth={1.5} />
                    </InputGroupButton>
                  </InputGroupAddon>
                )}
              </InputGroup>
              <div className="no-scrollbar flex min-h-0 scroll-fade flex-col gap-6 overflow-y-auto pb-6 scroll-fade-b-10 scroll-fade-t-0">
                <p role="status" className="sr-only">
                  {query && `${resultCount} results`}
                </p>
                {groups.length === 0 && (
                  <Empty className="animate-fade border-0">
                    <EmptyHeader>
                      <EmptyTitle>No results for "{query}"</EmptyTitle>
                      <EmptyDescription>
                        Use a custom URL for any other OpenAI-compatible
                        service.
                      </EmptyDescription>
                    </EmptyHeader>
                    {customUrl && (
                      <EmptyContent>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openForm({ provider: customUrl })}
                        >
                          Use a custom URL
                        </Button>
                      </EmptyContent>
                    )}
                  </Empty>
                )}
                {groups.map(({ group, label, providers }) => (
                  <section key={group} aria-label={label}>
                    {!initialGroup && (
                      <h3 className="sticky top-0 z-10 bg-popover pb-1 text-xs font-medium text-muted-foreground">
                        {label}
                      </h3>
                    )}
                    <ProviderList
                      providers={providers}
                      renderRow={(provider) =>
                        renderRow(provider, (failure) =>
                          openForm({ provider, failure })
                        )
                      }
                    />
                  </section>
                ))}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
