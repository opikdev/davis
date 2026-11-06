import type { Account, AppStatus } from "@/features/ai-setup/api"

function planLabel(plan: string) {
  return plan.charAt(0).toUpperCase() + plan.slice(1)
}

export function accountLabel(account: Account | null) {
  if (!account?.email) return undefined
  return account.plan
    ? `${account.email} · ${planLabel(account.plan)}`
    : account.email
}

export function appStatusLabel(app: AppStatus) {
  if (app.signedIn === false) return "Not signed in"
  if (accountLabel(app.account)) return accountLabel(app.account)
  return app.signedIn ? "Signed in" : "Found on this computer"
}
