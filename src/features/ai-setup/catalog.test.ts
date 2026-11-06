import { expect, test } from "vitest"

import { brandIconUrl } from "@/features/ai-setup/brand-icon"
import { PROVIDERS, providerById } from "@/features/ai-setup/catalog"

test("every provider icon points to a real file", () => {
  const missing = PROVIDERS.filter(
    (provider) => provider.icon && !brandIconUrl(provider.icon)
  ).map((provider) => provider.icon)

  expect(missing).toEqual([])
})

test("only the custom URL option has no brand icon", () => {
  const withoutIcon = PROVIDERS.filter((provider) => !provider.icon).map(
    (provider) => provider.id
  )

  expect(withoutIcon).toEqual(["custom"])
})

test("provider ids are unique", () => {
  const ids = PROVIDERS.map((provider) => provider.id)

  expect(new Set(ids).size).toBe(ids.length)
})

test("keeps providers out of the app until they're tested for real", () => {
  const ids = PROVIDERS.map(({ id }) => id)

  for (const id of [
    "microsoft-azure",
    "bedrock-aws",
    "vertexai-google",
    "cloudflare",
  ]) {
    expect(ids).not.toContain(id)
    expect(providerById(id)).toBeUndefined()
  }
  expect(ids).toContain("openrouter")
})
