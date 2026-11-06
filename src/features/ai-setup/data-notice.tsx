import type { Provider } from "@/features/ai-setup/catalog"

export function DataNotice({ provider }: { provider: Provider }) {
  return (
    <>
      {provider.group === "local"
        ? "Everything stays on this computer."
        : `Your questions and your table and column names go to ${provider.dataRecipient}.`}
    </>
  )
}
