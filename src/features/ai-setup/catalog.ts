import providers from "../../../crates/ai/providers.json"

export type ProviderGroup = "api-key" | "local" | "app" | "router"

export type Provider = {
  id: string
  name: string
  group: ProviderGroup
  connectLabel?: string
  destination?: string
  dataRecipient?: string
  icon?: string
  keyUrl?: string
  downloadUrl?: string
  defaultUrl?: string
  needsUrl?: boolean
  hidden?: boolean
  keyOptional?: boolean
  installCommand?: string
  installCommandWindows?: string
  installRequires?: string
  installRequiresWindows?: string
  signInCommand?: string
}

export const PROVIDERS = (providers as Provider[]).filter(
  (provider) => !provider.hidden
)

export function installCommandFor(provider: Provider, os: string) {
  return os === "windows" && provider.installCommandWindows
    ? provider.installCommandWindows
    : provider.installCommand
}

function installRequirementFor(provider: Provider, os: string) {
  return os === "windows" && provider.installCommandWindows
    ? provider.installRequiresWindows
    : provider.installRequires
}

export function canInstall(provider: Provider, os: string, hasNpm: boolean) {
  return installRequirementFor(provider, os) !== "npm" || hasNpm
}

export function providersInGroup(group: ProviderGroup) {
  return PROVIDERS.filter((provider) => provider.group === group)
}

export function providerById(id: string) {
  return PROVIDERS.find((provider) => provider.id === id)
}
