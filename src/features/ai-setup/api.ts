import { Channel, invoke } from "@tauri-apps/api/core"

export type Account = {
  email: string | null
  plan: string | null
}

export type AppStatus = {
  id: string
  installed: boolean
  signedIn: boolean | null
  account: Account | null
}

export type DetectedTools = {
  os: string
  apps: AppStatus[]
  localServers: string[]
  hasNpm: boolean
}

export type ConnectionRequest = {
  providerId: string
  apiKey?: string
  url?: string
}

export type Connection = {
  providerId: string
  account: Account | null
}

export type Model = {
  id: string
  name: string
  efforts: string[]
  defaultEffort: string | null
}

export type ChosenModel = {
  providerId: string
  modelId: string
  modelName: string
  effort: string | null
}

export function detectAiTools() {
  return invoke<DetectedTools>("detect_ai_tools")
}

export function getConnectedProviders() {
  return invoke<string[]>("connected_providers")
}

export function listModels(providerId: string) {
  return invoke<Model[]>("list_models", { providerId })
}

export function getChosenModel() {
  return invoke<ChosenModel | null>("chosen_model")
}

export function chooseModel(choice: ChosenModel) {
  return invoke<void>("choose_model", { choice })
}

export function connectProvider(request: ConnectionRequest) {
  return invoke<Connection>("connect_provider", { request })
}

export function disconnectProvider(providerId: string) {
  return invoke<void>("disconnect_provider", { providerId })
}

export function openSignIn(providerId: string) {
  return invoke<void>("open_sign_in", { providerId })
}

export function installApp(
  providerId: string,
  onOutput: (line: string) => void
) {
  const output = new Channel<string>()
  output.onmessage = onOutput
  return invoke<AppStatus>("install_app", { providerId, onOutput: output })
}
