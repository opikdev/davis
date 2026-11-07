import { useEffect, useState } from "react"

import { StepLayout } from "@/components/step-layout"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { PlusSignIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { AddAiDialog } from "@/features/ai-setup/add-ai-dialog"
import {
  PROVIDERS,
  canInstall,
  type Provider,
  type ProviderGroup,
} from "@/features/ai-setup/catalog"
import type { ConnectFailure } from "@/features/ai-setup/failure-message"
import { ProviderList } from "@/features/ai-setup/provider-list"
import { ProviderRow } from "@/features/ai-setup/provider-row"
import { StartOptions } from "@/features/ai-setup/start-options"
import type { useConnections } from "@/features/ai-setup/use-connections"
import type { useDetectedTools } from "@/features/ai-setup/use-detected-tools"
import { openExternal } from "@/lib/open-external"
import { playSound } from "@/lib/sound/player"

type Detection = ReturnType<typeof useDetectedTools>

type OpenDialog = {
  group?: ProviderGroup
  form?: { provider: Provider; failure?: ConnectFailure }
}

type AiSetupProps = {
  stepLabel: string
  detection: Detection
  connections: ReturnType<typeof useConnections>
  onBack: () => void
  onDone: () => void
}

function namesLabel(names: string[]) {
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`
}

export function AiSetup({
  stepLabel,
  detection,
  connections,
  onBack,
  onDone,
}: AiSetupProps) {
  const { tools, isDetecting } = detection
  const {
    rows,
    connect,
    disconnect,
    install,
    signIn,
    cancelSignIn,
    clearFailure,
  } = connections
  const [dialog, setDialog] = useState<OpenDialog>()
  const isDialogOpen = Boolean(dialog)

  useEffect(() => {
    if (isDialogOpen) playSound("open")
  }, [isDialogOpen])

  function isFound(provider: Provider) {
    return (
      tools.localServers.includes(provider.id) ||
      tools.apps.some((app) => app.id === provider.id)
    )
  }

  const found = PROVIDERS.filter(
    (provider) =>
      isFound(provider) ||
      (rows[provider.id] && rows[provider.id].status !== "idle")
  )
  const connected = found.filter(
    (provider) => rows[provider.id]?.status === "connected"
  )
  const isReady = connected.length > 0
  const shortList = found.filter(
    (provider) => !isReady || (rows[provider.id]?.status ?? "idle") !== "idle"
  )

  async function connectFromRow(
    provider: Provider,
    onNeedsForm: (failure?: ConnectFailure) => void
  ) {
    if (provider.group === "api-key" || provider.group === "router") {
      onNeedsForm()
      return
    }
    const failure = await connect(provider)
    if (failure && provider.group === "local") {
      clearFailure(provider)
      onNeedsForm(failure)
    }
  }

  function row(
    provider: Provider,
    onNeedsForm: (failure?: ConnectFailure) => void
  ) {
    return (
      <ProviderRow
        key={provider.id}
        provider={provider}
        state={rows[provider.id] ?? { status: "idle" }}
        app={tools.apps.find(({ id }) => id === provider.id)}
        isDetecting={isDetecting}
        isRunning={tools.localServers.includes(provider.id)}
        canInstall={canInstall(provider, tools.os, tools.hasNpm)}
        onConnect={() => void connectFromRow(provider, onNeedsForm)}
        onInstall={() => void install(provider)}
        onSignIn={() => void signIn(provider)}
        onCancelSignIn={() => cancelSignIn(provider)}
        onDisconnect={() => void disconnect(provider)}
        onGet={() => openExternal(provider.downloadUrl ?? "")}
      />
    )
  }

  function title() {
    if (isDetecting) return "Checking your computer"
    return isReady ? "You're ready" : "Connect an AI"
  }

  function description() {
    if (isDetecting) return "This only takes a moment."
    if (isReady) {
      const names = namesLabel(connected.map(({ name }) => name))
      return `Davis can use ${names}. You can choose which one when you start a chat.`
    }
    return "Davis uses AI to turn your questions into answers and charts."
  }

  return (
    <StepLayout
      stepLabel={stepLabel}
      title={title()}
      description={description()}
      leadingAction={
        <Button variant="ghost" onClick={onBack} className="-ml-3.5">
          Back
        </Button>
      }
      trailingAction={
        isReady ? (
          <Button key="start" onClick={onDone} className="animate-pop">
            Start using Davis
          </Button>
        ) : (
          <Button
            key="skip"
            variant="ghost"
            onClick={onDone}
            disabled={isDetecting}
          >
            Skip for now
          </Button>
        )
      }
    >
      {isDetecting ? (
        <p
          role="status"
          className="flex animate-fade items-center gap-2 text-sm text-muted-foreground"
        >
          <Spinner />
          Looking for AI tools…
        </p>
      ) : (
        <div className="flex animate-stagger flex-col gap-4">
          {shortList.length > 0 && (
            <ProviderList
              className="animate-stagger"
              providers={shortList}
              renderRow={(provider) =>
                row(provider, (failure) =>
                  setDialog({ form: { provider, failure } })
                )
              }
            />
          )}
          {shortList.length === 0 ? (
            <StartOptions onSelect={(group) => setDialog({ group })} />
          ) : (
            <div>
              <Button variant="outline" size="sm" onClick={() => setDialog({})}>
                <HugeiconsIcon
                  icon={PlusSignIcon}
                  strokeWidth={1.5}
                  data-icon="inline-start"
                />
                Add another AI
              </Button>
            </div>
          )}
          {shortList.length === 0 && (
            <div>
              <Button
                variant="link"
                className="h-auto p-0 text-xs text-muted-foreground"
                onClick={() => setDialog({})}
              >
                See all options, including gateways
              </Button>
            </div>
          )}
          <p className="text-xs/relaxed text-muted-foreground">
            Your files stay on this computer. When you ask a question, the AI
            you choose gets your question and your table and column names.
          </p>
        </div>
      )}
      {dialog && (
        <AddAiDialog
          key={dialog.form?.provider.id ?? "list"}
          initialGroup={dialog.group}
          initialForm={dialog.form}
          isFound={isFound}
          renderRow={row}
          onConnect={(provider, request) => connect(provider, request)}
          onFormExit={clearFailure}
          onClose={() => setDialog(undefined)}
        />
      )}
    </StepLayout>
  )
}
