import {
  AlertCircleIcon,
  ViewIcon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useId, useRef, useState } from "react"

import { ExternalLink } from "@/components/external-link"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import type { ConnectionRequest } from "@/features/ai-setup/api"
import type { Provider } from "@/features/ai-setup/catalog"
import { DataNotice } from "@/features/ai-setup/data-notice"
import type { ConnectFailure } from "@/features/ai-setup/failure-message"
import { playSound } from "@/lib/sound/player"

type ConnectFormProps = {
  provider: Provider
  initialFailure?: ConnectFailure
  onConnect: (
    request: Omit<ConnectionRequest, "providerId">
  ) => Promise<ConnectFailure | undefined>
  onDone: () => void
  onBack: () => void
}

function failurePlace(
  failure: ConnectFailure | undefined,
  asksForKey: boolean,
  asksForUrl: boolean | undefined
) {
  if (failure?.field === "key" && asksForKey) return "key"
  if (failure?.field === "url" && asksForUrl) return "url"
  return "form"
}

function urlProblem(value: string) {
  if (!value.trim()) return "Enter an address."
  if (!URL.canParse(value) || !/^https?:/.test(value)) {
    return "Enter a full address, like https://example.com."
  }
  return undefined
}

export function ConnectForm({
  provider,
  initialFailure,
  onConnect,
  onDone,
  onBack,
}: ConnectFormProps) {
  const [apiKey, setApiKey] = useState("")
  const [url, setUrl] = useState(provider.defaultUrl ?? "")
  const [showsKey, setShowsKey] = useState(false)
  const isLocal = provider.group === "local"
  const asksForKey = !isLocal
  const asksForUrl = provider.needsUrl
  const initialPlace = failurePlace(initialFailure, asksForKey, asksForUrl)
  const initialMessage = initialFailure?.message
  const [urlError, setUrlError] = useState(
    initialPlace === "url" ? initialMessage : undefined
  )
  const [keyError, setKeyError] = useState(
    initialPlace === "key" ? initialMessage : undefined
  )
  const [formError, setFormError] = useState(
    initialPlace === "form" ? initialMessage : undefined
  )
  const [isConnecting, setIsConnecting] = useState(false)
  const keyInputId = useId()
  const urlInputId = useId()
  const urlInput = useRef<HTMLInputElement>(null)
  const keyInput = useRef<HTMLInputElement>(null)

  const connectAction = `Connect ${provider.connectLabel ?? provider.name}`

  function changeUrl(next: string) {
    setUrl(next)
    if (urlError) setUrlError(urlProblem(next))
  }

  function changeKey(next: string) {
    setApiKey(next)
    setKeyError(undefined)
  }

  function showFailure(failure: ConnectFailure) {
    const place = failurePlace(failure, asksForKey, asksForUrl)
    if (place === "key") {
      setKeyError(failure.message)
      keyInput.current?.focus()
      keyInput.current?.select()
    } else if (place === "url") {
      setUrlError(failure.message)
      urlInput.current?.focus()
    } else {
      setFormError(failure.message)
    }
  }

  async function connect(event: React.FormEvent) {
    event.preventDefault()
    if (isConnecting) return

    const nextUrlError = asksForUrl ? urlProblem(url) : undefined
    const nextKeyError =
      asksForKey && !provider.keyOptional && !apiKey.trim()
        ? "Enter your API key."
        : undefined
    setUrlError(nextUrlError)
    setKeyError(nextKeyError)
    setFormError(undefined)
    if (nextUrlError) urlInput.current?.focus()
    else if (nextKeyError) keyInput.current?.focus()
    if (nextUrlError || nextKeyError) {
      playSound("error")
      return
    }

    setIsConnecting(true)
    const failure = await onConnect({
      apiKey: apiKey || undefined,
      url: (asksForUrl && url) || undefined,
    })
    setIsConnecting(false)
    if (failure) showFailure(failure)
    else onDone()
  }

  return (
    <form
      noValidate
      onSubmit={connect}
      className="flex min-h-full flex-col gap-5"
    >
      <FieldGroup className="gap-4">
        {asksForUrl && (
          <Field data-invalid={Boolean(urlError)}>
            <div className="flex items-center justify-between gap-3">
              <FieldLabel htmlFor={urlInputId} className="text-sm">
                Address
              </FieldLabel>
              {isLocal && provider.downloadUrl && (
                <ExternalLink
                  href={provider.downloadUrl}
                  label={`Get ${provider.name}`}
                  className="text-xs"
                >
                  Get {provider.name}
                </ExternalLink>
              )}
            </div>
            <Input
              ref={urlInput}
              id={urlInputId}
              value={url}
              onChange={(event) => changeUrl(event.target.value)}
              onBlur={() => {
                if (url.trim() && !urlError) setUrlError(urlProblem(url))
              }}
              placeholder="https://"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              required
              aria-invalid={Boolean(urlError)}
              aria-describedby={urlError ? `${urlInputId}-error` : undefined}
              className="h-9 text-sm text-foreground md:text-sm"
            />
            {urlError && (
              <FieldError
                id={`${urlInputId}-error`}
                className="animate-reveal overflow-hidden select-text"
              >
                {urlError}
              </FieldError>
            )}
          </Field>
        )}
        {asksForKey && (
          <Field data-invalid={Boolean(keyError)}>
            <div className="flex items-center justify-between gap-3">
              <FieldLabel htmlFor={keyInputId} className="text-sm">
                API key{provider.keyOptional ? " (optional)" : ""}
              </FieldLabel>
              {provider.keyUrl && (
                <ExternalLink
                  href={provider.keyUrl}
                  label={`Get an API key from ${provider.name}`}
                  className="text-xs"
                >
                  Get a key
                </ExternalLink>
              )}
            </div>
            <InputGroup className="h-9">
              <InputGroupInput
                ref={keyInput}
                id={keyInputId}
                type={showsKey ? "text" : "password"}
                value={apiKey}
                onChange={(event) => changeKey(event.target.value)}
                aria-invalid={Boolean(keyError)}
                aria-describedby={[
                  keyError && `${keyInputId}-error`,
                  `${keyInputId}-description`,
                ]
                  .filter(Boolean)
                  .join(" ")}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                required={!provider.keyOptional}
                className="text-sm text-foreground md:text-sm"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-sm"
                  aria-label={showsKey ? "Hide API key" : "Show API key"}
                  aria-pressed={showsKey}
                  onClick={() => setShowsKey((current) => !current)}
                >
                  <HugeiconsIcon
                    icon={showsKey ? ViewOffIcon : ViewIcon}
                    strokeWidth={1.5}
                  />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            {keyError && (
              <FieldError
                id={`${keyInputId}-error`}
                className="animate-reveal overflow-hidden select-text"
              >
                {keyError}
              </FieldError>
            )}
            <FieldDescription
              id={`${keyInputId}-description`}
              className="text-xs/relaxed"
            >
              Saved in your computer's keychain and only sent to{" "}
              {provider.destination ?? provider.name}.{" "}
              <DataNotice provider={provider} />
            </FieldDescription>
          </Field>
        )}
      </FieldGroup>
      {formError && (
        <Alert variant="destructive" className="animate-reveal overflow-hidden">
          <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={1.5} />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}
      {!asksForKey && (
        <p className="text-xs/relaxed text-muted-foreground">
          <DataNotice provider={provider} />
        </p>
      )}
      <div className="mt-auto flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="xl"
          onClick={onBack}
          disabled={isConnecting}
          focusableWhenDisabled
        >
          Back
        </Button>
        <Button
          type="submit"
          size="xl"
          disabled={isConnecting}
          focusableWhenDisabled
        >
          {isConnecting && <Spinner />}
          {isConnecting ? "Connecting…" : connectAction}
        </Button>
      </div>
    </form>
  )
}
