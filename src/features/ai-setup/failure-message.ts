import type { Provider } from "@/features/ai-setup/catalog"
import { errorKind, toErrorMessage } from "@/lib/ipc-error"

export type ConnectFailure = { message: string; field?: "key" | "url" }

function failureField(error: unknown): ConnectFailure["field"] {
  switch (errorKind(error)) {
    case "rejected-key":
    case "key-not-allowed":
      return "key"
    case "bad-address":
    case "insecure-address":
    case "unreachable":
      return "url"
    default:
      return undefined
  }
}

export function connectFailure(
  error: unknown,
  provider: Provider
): ConnectFailure {
  return {
    message: failureMessage(error, provider),
    field: failureField(error),
  }
}

export function disconnectFailureMessage(provider: Provider) {
  return `Davis couldn't disconnect ${provider.destination ?? provider.name}. Check that your keychain is unlocked, then try again.`
}

export function failureMessage(error: unknown, provider: Provider) {
  const destination = provider.destination ?? provider.name

  switch (errorKind(error)) {
    case "rejected-key":
      return `This key didn't work with ${destination}. Check that you copied all of it, then try again.`
    case "key-not-allowed":
      return `${destination} refused this key. Check that it's allowed to list models, then try again.`
    case "unreachable":
      return provider.group === "local"
        ? `Can't reach ${destination}. Open ${destination}, then try again.`
        : `Can't reach ${destination}. Check your connection and the address, then try again.`
    case "busy":
      return `${destination} is busy right now. Try again in a moment.`
    case "bad-address":
      return "Nothing answered at this address. Check it, then try again."
    case "insecure-address":
      return "Keys can only be sent to an https address or to this computer. Change the address, then try again."
    case "not-signed-in":
      return `Sign in to ${destination} first, then try again.`
    case "check-failed":
      return `Davis couldn't check ${destination}. Try again.`
    case "install-permission":
      return `Davis doesn't have permission to install ${destination}. Run this command in Terminal instead:`
    case "not-detected-after-install":
      return `${destination} finished installing, but Davis can't find it. Try running this command in Terminal:`
    case "install-failed":
      return `${destination} didn't install. Check your connection and try again, or run this command in Terminal:`
    case "terminal":
      return "Davis couldn't open Terminal. Run this command yourself:"
    case "keychain":
      return "The key works, but Davis couldn't save it in your keychain. Check that your keychain is unlocked, then try again."
    default:
      return toErrorMessage(error)
  }
}
