import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { cn } from "cn"
import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { accountLabel, appStatusLabel } from "@/features/ai-setup/account-label"
import type { AppStatus } from "@/features/ai-setup/api"
import { BrandIcon } from "@/features/ai-setup/brand-icon"
import type { Provider } from "@/features/ai-setup/catalog"
import type { RowState } from "@/features/ai-setup/use-connections"

const COPIED_MS = 2000

type ProviderRowProps = {
  provider: Provider
  state: RowState
  app?: AppStatus
  isDetecting: boolean
  isRunning: boolean
  canInstall: boolean
  onConnect: () => void
  onInstall: () => void
  onSignIn: () => void
  onCancelSignIn: () => void
  onDisconnect: () => void
  onGet: () => void
}

function CopyCommand({ command }: { command: string }) {
  const [isCopied, setIsCopied] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isCopied) return
    const reset = setTimeout(() => setIsCopied(false), COPIED_MS)
    return () => clearTimeout(reset)
  }, [isCopied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(command)
      setIsCopied(true)
    } catch {
      input.current?.select()
    }
  }

  return (
    <InputGroup>
      <InputGroupInput
        ref={input}
        readOnly
        value={command}
        aria-label="Command"
        onFocus={(event) => event.target.select()}
        className="font-mono"
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton onClick={() => void copy()}>
          <span key={String(isCopied)} className="animate-fade">
            {isCopied ? "Copied" : "Copy"}
          </span>
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}

function announcementFor(name: string, state: RowState) {
  if (state.status === "connecting") return `Connecting ${name}`
  if (state.status === "connected") return `${name} connected`
  if (state.status === "installing") return `Installing ${name}`
  if (state.status === "signing-in") return `Waiting for ${name} sign-in`
  if (state.status === "needs-sign-in") return `${name} needs sign-in`
  return ""
}

function detailFor(
  provider: Provider,
  state: RowState,
  app: AppStatus | undefined,
  isDetecting: boolean,
  isRunning: boolean,
  canInstall: boolean
) {
  const account = state.status === "connected" && accountLabel(state.account)
  if (account) return account
  if (state.status === "installing") return state.line ?? "Installing…"
  if (state.status === "signing-in") return "Finish signing in, then come back"
  if (state.status === "needs-sign-in") return "Not signed in"
  if (provider.group === "local" && isRunning) {
    return "Running on this computer"
  }
  if (provider.group !== "app") return undefined
  if (isDetecting) return "Checking this computer…"
  if (app) return appStatusLabel(app)
  return canInstall ? "Not installed" : "Not installed. Needs Node.js"
}

export function ProviderRow({
  provider,
  state,
  app,
  isDetecting,
  isRunning,
  canInstall,
  onConnect,
  onInstall,
  onSignIn,
  onCancelSignIn,
  onDisconnect,
  onGet,
}: ProviderRowProps) {
  const actions = useRef<HTMLDivElement>(null)
  const keepsFocus = useRef(false)

  // An action replaces the button that was pressed, which would drop keyboard focus.
  useLayoutEffect(() => {
    const root = actions.current
    if (
      !keepsFocus.current ||
      !root ||
      document.activeElement !== document.body
    ) {
      return
    }
    const target = root.querySelector("button:not(:disabled)") ?? root
    ;(target as HTMLElement).focus()
  }, [state.status])

  const detail = detailFor(
    provider,
    state,
    app,
    isDetecting,
    isRunning,
    canInstall
  )
  const name = provider.name
  const isApp = provider.group === "app"

  function keepFocus(handler: () => void) {
    return () => {
      keepsFocus.current = true
      handler()
    }
  }

  function action() {
    if (state.status === "connected") {
      return (
        <>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Disconnect ${name}`}
            onClick={keepFocus(onDisconnect)}
            className="text-muted-foreground opacity-0 transition-opacity group-hover/item:opacity-100 focus-visible:opacity-100"
          >
            Disconnect
          </Button>
          <Badge variant="secondary" className="animate-pop">
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              strokeWidth={2}
              data-icon="inline-start"
              className="text-success"
            />
            Connected
          </Badge>
        </>
      )
    }
    if (state.status === "connecting") {
      return (
        <Button variant="outline" size="lg" disabled>
          <Spinner />
          Connecting…
        </Button>
      )
    }
    if (state.status === "installing") {
      return <Spinner className="text-muted-foreground" />
    }
    if (state.status === "signing-in") {
      return (
        <>
          <Spinner className="text-muted-foreground" />
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Cancel ${name} sign-in`}
            onClick={keepFocus(onCancelSignIn)}
            className="text-muted-foreground"
          >
            Cancel
          </Button>
        </>
      )
    }
    if (isApp && isDetecting) return null
    if (isApp && !app) {
      return canInstall ? (
        <Button
          variant="outline"
          size="lg"
          aria-label={`Install ${name}`}
          onClick={keepFocus(onInstall)}
        >
          Install
        </Button>
      ) : (
        <Button
          variant="outline"
          size="lg"
          aria-label={`Get ${name}`}
          onClick={onGet}
        >
          Get
        </Button>
      )
    }
    if (app?.signedIn === false || state.status === "needs-sign-in") {
      return (
        <Button
          variant="outline"
          size="lg"
          aria-label={`Sign in to ${name}`}
          onClick={keepFocus(onSignIn)}
        >
          Sign in
        </Button>
      )
    }
    return (
      <Button
        variant="outline"
        size="lg"
        aria-label={`Connect ${name}`}
        onClick={keepFocus(onConnect)}
      >
        Connect
      </Button>
    )
  }

  return (
    <Item role="listitem" className="rounded-none px-0">
      <ItemMedia className="self-center!">
        <BrandIcon icon={provider.icon} />
      </ItemMedia>
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="text-sm">{name}</ItemTitle>
        {detail && (
          <ItemDescription
            key={state.status}
            className={cn(
              "animate-fade",
              state.status === "installing" && "font-mono"
            )}
          >
            {detail}
          </ItemDescription>
        )}
      </ItemContent>
      <ItemActions
        key={state.status}
        ref={actions}
        tabIndex={-1}
        className="animate-fade outline-none"
      >
        {action()}
      </ItemActions>
      <span role="status" className="sr-only">
        {announcementFor(name, state)}
      </span>
      {state.status === "failed" && (
        <ItemFooter className="animate-reveal flex-col items-stretch gap-2 overflow-hidden">
          <Alert variant="destructive">
            <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={1.5} />
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
          {state.command && <CopyCommand command={state.command} />}
        </ItemFooter>
      )}
    </Item>
  )
}
