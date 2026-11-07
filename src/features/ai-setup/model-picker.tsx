import { ArrowDown01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { ChosenModel, Model } from "@/features/ai-setup/api"
import { BrandIcon } from "@/features/ai-setup/brand-icon"
import type { Provider } from "@/features/ai-setup/catalog"
import { EffortMeter, effortLabel } from "@/features/ai-setup/effort-meter"
import { useChosenModel } from "@/features/ai-setup/use-chosen-model"
import { useConnectedProviders } from "@/features/ai-setup/use-connected-providers"
import { useModels } from "@/features/ai-setup/use-models"

function choiceFor(providerId: string, model: Model, effort?: string | null) {
  const keepsEffort = effort != null && model.efforts.includes(effort)
  return {
    providerId,
    modelId: model.id,
    modelName: model.name,
    effort: keepsEffort
      ? effort
      : (model.defaultEffort ?? model.efforts[0] ?? null),
  }
}

type ProviderRailProps = {
  providers: Provider[]
  shownId: string
  onShow: (id: string) => void
}

function ProviderRail({ providers, shownId, onShow }: ProviderRailProps) {
  return (
    <ToggleGroup
      aria-label="AI"
      orientation="vertical"
      value={[shownId]}
      onValueChange={([id]) => {
        if (id) onShow(id)
      }}
      className="shrink-0 gap-1 overflow-y-auto border-r bg-sidebar/50 p-1.5"
    >
      {providers.map((provider) => (
        <Tooltip key={provider.id}>
          <TooltipTrigger
            render={
              <ToggleGroupItem
                value={provider.id}
                aria-label={provider.name}
                className="size-7 p-0 text-muted-foreground aria-pressed:text-foreground"
              />
            }
          >
            <BrandIcon icon={provider.icon} className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent side="right">{provider.name}</TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  )
}

type ModelListProps = {
  provider: Provider
  models?: Model[]
  hasFailed: boolean
  chosenId?: string
  highlightedId?: string
  onHighlight: (id: string) => void
  onRetry: () => void
  onPick: (model: Model) => void
}

function ModelList({
  provider,
  models,
  hasFailed,
  chosenId,
  highlightedId,
  onHighlight,
  onRetry,
  onPick,
}: ModelListProps) {
  if (hasFailed) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Couldn't load the models from {provider.name}.
        </p>
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </div>
    )
  }

  if (!models) {
    return (
      <div
        role="status"
        aria-label="Loading models"
        className="flex flex-1 flex-col gap-2 p-3"
      >
        {[0, 1, 2, 3].map((row) => (
          <Skeleton key={row} className="h-7 w-full" />
        ))}
      </div>
    )
  }

  return (
    <Command
      key={provider.id}
      label="Search models"
      value={highlightedId ?? chosenId}
      onValueChange={onHighlight}
      className="min-w-0 flex-1 rounded-none bg-transparent p-1.5"
    >
      <CommandInput placeholder="Search models" />
      <CommandList className="mt-1.5 max-h-none flex-1 scroll-py-1 px-1">
        <CommandEmpty>No models found</CommandEmpty>
        {models.map((model) => (
          <CommandItem
            key={model.id}
            value={model.id}
            keywords={[model.name]}
            data-checked={model.id === chosenId}
            onSelect={() => onPick(model)}
          >
            <BrandIcon icon={provider.icon} className="size-3.5" />
            <span className="truncate">{model.name}</span>
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  )
}

type EffortListProps = {
  model?: Model
  effort?: string | null
  onPick: (effort: string) => void
}

function EffortList({ model, effort, onPick }: EffortListProps) {
  const efforts = model?.efforts ?? []

  return (
    <div className="flex w-36 shrink-0 flex-col gap-1.5 border-l p-2">
      <p className="px-1 text-xs font-medium text-muted-foreground">Effort</p>
      {efforts.length === 0 ? (
        <p className="px-1 text-xs/relaxed text-muted-foreground">
          {model
            ? "This model has no effort setting."
            : "Point at a model to see its effort levels."}
        </p>
      ) : (
        <RadioGroup
          aria-label="Effort"
          value={effort}
          onValueChange={(value: string) => onPick(value)}
          className="gap-0.5"
        >
          {efforts.map((level, index) => (
            <Label
              key={level}
              onClick={(event) => {
                // A radio ignores clicks on its checked value, but this one still has to pick.
                if (level !== effort) return
                event.preventDefault()
                onPick(level)
              }}
              className="group/effort relative h-7 gap-2 rounded-md px-2 font-normal text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring/40 has-data-checked:bg-muted has-data-checked:text-foreground"
            >
              <RadioGroupItem value={level} className="absolute opacity-0" />
              <EffortMeter
                level={index + 1}
                total={efforts.length}
                className="group-has-data-checked/effort:text-primary"
              />
              {effortLabel(level)}
              {level === model?.defaultEffort && (
                <span className="ml-auto text-xs text-muted-foreground">
                  Default
                </span>
              )}
            </Label>
          ))}
        </RadioGroup>
      )}
    </div>
  )
}

export function ModelPicker() {
  const providers = useConnectedProviders()
  const [chosen, choose] = useChosenModel()
  const [isOpen, setIsOpen] = useState(false)
  const [viewedId, setViewedId] = useState<string>()
  const [highlightedId, setHighlightedId] = useState<string>()

  const saved = providers?.some(({ id }) => id === chosen?.providerId)
    ? chosen
    : null
  const activeId = saved?.providerId ?? providers?.[0]?.id
  const shownId = viewedId ?? activeId
  const { modelsOf, hasFailed, retry } = useModels(shownId)

  if (!providers) return null
  if (!activeId || !shownId) {
    return (
      <span className="px-2 text-xs text-muted-foreground">
        No AI connected
      </span>
    )
  }

  const activeProvider = providers.find(({ id }) => id === activeId)
  const shownProvider = providers.find(({ id }) => id === shownId)
  if (!activeProvider || !shownProvider) return null

  const activeModels = modelsOf(activeId)
  const models = modelsOf(shownId)
  const isGone = saved && activeModels?.every(({ id }) => id !== saved.modelId)
  const current: ChosenModel | undefined =
    saved && !isGone
      ? saved
      : activeModels?.[0] && choiceFor(activeId, activeModels[0])
  const shownChoice = current?.providerId === shownId ? current : undefined
  const currentEfforts = activeModels?.find(
    ({ id }) => id === current?.modelId
  )?.efforts
  const effortIndex = currentEfforts?.indexOf(current?.effort ?? "") ?? -1
  const panelModel =
    models?.find(({ id }) => id === highlightedId) ??
    models?.find(({ id }) => id === shownChoice?.modelId)
  const panelChoice =
    panelModel &&
    (panelModel.id === shownChoice?.modelId
      ? shownChoice
      : choiceFor(shownId, panelModel, current?.effort))

  function pickModel(model: Model) {
    choose(choiceFor(shownId as string, model, current?.effort))
    if (model.efforts.length === 0) setIsOpen(false)
  }

  function pickEffort(effort: string) {
    if (!panelChoice) return
    choose({ ...panelChoice, effort })
    setIsOpen(false)
  }

  function showProvider(id: string) {
    setViewedId(id)
    setHighlightedId(undefined)
  }

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open)
        if (!open) showProvider(activeId)
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            aria-label="Choose a model"
            className="max-w-72 animate-fade font-normal"
          />
        }
      >
        <BrandIcon icon={activeProvider.icon} className="size-3.5" />
        <span className="truncate">
          {current?.modelName ?? activeProvider.name}
        </span>
        {current?.effort && (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            {currentEfforts && effortIndex >= 0 && (
              <EffortMeter
                level={effortIndex + 1}
                total={currentEfforts.length}
                className="text-primary"
              />
            )}
            {effortLabel(current.effort)}
          </span>
        )}
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          strokeWidth={1.5}
          className="size-3.5 text-muted-foreground"
        />
      </PopoverTrigger>
      <PopoverContent
        aria-label="Choose a model"
        side="bottom"
        align="end"
        sideOffset={6}
        className="h-72 w-110 flex-row gap-0 overflow-hidden p-0 shadow-2xl"
      >
        {providers.length > 1 && (
          <ProviderRail
            providers={providers}
            shownId={shownId}
            onShow={showProvider}
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <ModelList
            provider={shownProvider}
            models={models}
            hasFailed={hasFailed}
            chosenId={shownChoice?.modelId}
            highlightedId={highlightedId}
            onHighlight={setHighlightedId}
            onRetry={retry}
            onPick={pickModel}
          />
        </div>
        <EffortList
          model={panelModel}
          effort={panelChoice?.effort}
          onPick={pickEffort}
        />
      </PopoverContent>
    </Popover>
  )
}
