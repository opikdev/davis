import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"

import {
  connectProvider,
  disconnectProvider,
  installApp,
  openSignIn,
  type Account,
  type Connection,
  type ConnectionRequest,
  type DetectedTools,
} from "@/features/ai-setup/api"
import {
  installCommandFor,
  providerById,
  type Provider,
} from "@/features/ai-setup/catalog"
import {
  connectFailure,
  disconnectFailureMessage,
  failureMessage,
} from "@/features/ai-setup/failure-message"
import { errorKind } from "@/lib/ipc-error"
import { playSound } from "@/lib/sound/player"

const SIGN_IN_POLL_MS = 3000
const SIGN_IN_WAIT_LIMIT_MS = 10 * 60 * 1000

export type RowState =
  | { status: "idle" }
  | { status: "connecting" }
  | { status: "connected"; account: Account | null }
  | { status: "installing"; line?: string }
  | { status: "signing-in" }
  | { status: "needs-sign-in" }
  | { status: "failed"; message: string; command?: string }

const IDLE: RowState = { status: "idle" }

function rowForFailure(error: unknown, provider: Provider): RowState {
  if (errorKind(error) === "not-signed-in") {
    return { status: "needs-sign-in" }
  }
  return { status: "failed", message: failureMessage(error, provider) }
}

export function useConnections(
  tools: DetectedTools,
  isDetecting: boolean,
  refresh: () => Promise<DetectedTools>
) {
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const autoConnected = useRef(new Set<string>())
  const signInDeadlines = useRef(new Map<string, number>())
  const attempts = useRef(new Map<string, number>())
  const automaticSaves = useRef(new Map<string, Promise<Connection>>())

  const setRow = useCallback((id: string, row: RowState) => {
    setRows((current) => ({ ...current, [id]: row }))
  }, [])

  const startAttempt = useCallback((id: string) => {
    const attempt = (attempts.current.get(id) ?? 0) + 1
    attempts.current.set(id, attempt)
    return () => attempts.current.get(id) === attempt
  }, [])

  const connect = useCallback(
    async (
      provider: Provider,
      request: Omit<ConnectionRequest, "providerId"> = {}
    ) => {
      const isCurrent = startAttempt(provider.id)
      setRow(provider.id, { status: "connecting" })
      try {
        const { account } = await connectProvider({
          providerId: provider.id,
          ...request,
        })
        if (isCurrent()) {
          setRow(provider.id, { status: "connected", account })
          playSound("success")
        }
        return undefined
      } catch (error) {
        if (isCurrent()) {
          setRow(provider.id, rowForFailure(error, provider))
          playSound("error")
        }
        return connectFailure(error, provider)
      }
    },
    [setRow, startAttempt]
  )

  const connectReadyTool = useCallback(
    async (provider: Provider, account: Account | null) => {
      const isCurrent = startAttempt(provider.id)
      setRow(provider.id, { status: "connected", account })
      if (signInDeadlines.current.delete(provider.id)) playSound("success")
      const save = connectProvider({ providerId: provider.id })
      automaticSaves.current.set(provider.id, save)
      try {
        await save
      } catch (error) {
        if (isCurrent()) {
          setRow(provider.id, rowForFailure(error, provider))
          playSound("error")
        }
      }
    },
    [setRow, startAttempt]
  )

  useLayoutEffect(() => {
    if (isDetecting) return

    const signedInApps = tools.apps.filter((app) => app.signedIn === true)
    const ready = [
      ...signedInApps.map((app) => ({ id: app.id, account: app.account })),
      ...tools.localServers.map((id) => ({ id, account: null })),
    ]
    for (const { id, account } of ready) {
      const provider = providerById(id)
      if (!provider || autoConnected.current.has(id)) continue
      autoConnected.current.add(id)
      void connectReadyTool(provider, account)
    }
  }, [connectReadyTool, isDetecting, tools])

  const disconnect = useCallback(
    async (provider: Provider) => {
      startAttempt(provider.id)
      setRow(provider.id, IDLE)
      try {
        // A slower automatic save would otherwise restore what was just removed.
        await automaticSaves.current.get(provider.id)?.catch(() => undefined)
        await disconnectProvider(provider.id)
      } catch {
        setRow(provider.id, {
          status: "failed",
          message: disconnectFailureMessage(provider),
        })
        playSound("error")
      }
    },
    [setRow, startAttempt]
  )

  const install = useCallback(
    async (provider: Provider) => {
      setRow(provider.id, { status: "installing" })
      try {
        const app = await installApp(provider.id, (line) => {
          setRow(provider.id, { status: "installing", line })
        })
        autoConnected.current.add(provider.id)
        await refresh()
        if (app.signedIn === false) setRow(provider.id, IDLE)
        else await connect(provider)
      } catch (error) {
        setRow(provider.id, {
          status: "failed",
          message: failureMessage(error, provider),
          command: installCommandFor(provider, tools.os),
        })
        playSound("error")
      }
    },
    [connect, refresh, setRow, tools.os]
  )

  const signIn = useCallback(
    async (provider: Provider) => {
      autoConnected.current.delete(provider.id)
      signInDeadlines.current.set(
        provider.id,
        Date.now() + SIGN_IN_WAIT_LIMIT_MS
      )
      setRow(provider.id, { status: "signing-in" })
      try {
        await openSignIn(provider.id)
      } catch (error) {
        signInDeadlines.current.delete(provider.id)
        setRow(provider.id, {
          status: "failed",
          message: failureMessage(error, provider),
          command: provider.signInCommand,
        })
        playSound("error")
      }
    },
    [setRow]
  )

  const cancelSignIn = useCallback(
    (provider: Provider) => {
      signInDeadlines.current.delete(provider.id)
      setRow(provider.id, IDLE)
    },
    [setRow]
  )

  const isSigningIn = Object.values(rows).some(
    (row) => row.status === "signing-in"
  )

  useEffect(() => {
    if (!isSigningIn) return

    let isStopped = false
    let timer: ReturnType<typeof setTimeout>

    function expireSignIns() {
      for (const [id, deadline] of signInDeadlines.current) {
        if (Date.now() < deadline) continue
        signInDeadlines.current.delete(id)
        setRow(id, IDLE)
      }
    }

    async function poll() {
      await refresh().catch((error: unknown) => {
        console.error("Could not check sign-in", error)
      })
      if (isStopped) return
      expireSignIns()
      timer = setTimeout(() => void poll(), SIGN_IN_POLL_MS)
    }

    timer = setTimeout(() => void poll(), SIGN_IN_POLL_MS)
    return () => {
      isStopped = true
      clearTimeout(timer)
    }
  }, [isSigningIn, refresh, setRow])

  const clearFailure = useCallback((provider: Provider) => {
    setRows((current) =>
      current[provider.id]?.status === "failed"
        ? { ...current, [provider.id]: IDLE }
        : current
    )
  }, [])

  return {
    rows,
    connect,
    disconnect,
    install,
    signIn,
    cancelSignIn,
    clearFailure,
  }
}
