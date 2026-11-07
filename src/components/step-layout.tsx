import { useEffect, useRef } from "react"

import { TitleBar } from "@/components/title-bar"

type StepLayoutProps = {
  stepLabel: string
  title: string
  description?: React.ReactNode
  leadingAction?: React.ReactNode
  trailingAction?: React.ReactNode
  children?: React.ReactNode
}

export function StepLayout({
  stepLabel,
  title,
  description,
  leadingAction,
  trailingAction,
  children,
}: StepLayoutProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <div data-tauri-drag-region className="flex h-svh flex-col p-1">
      <div className="flex min-h-0 flex-1 flex-col rounded-xl border bg-background">
        <TitleBar label={stepLabel} />
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 pb-6">
          <div className="flex h-full max-h-160 w-full max-w-md flex-col">
            <main className="-mx-3 no-scrollbar flex min-h-0 flex-1 scroll-fade flex-col overflow-y-auto px-3 pt-6 pb-14 scroll-fade-b-14 scroll-fade-t-6">
              <div className="flex min-h-0 flex-1 animate-stagger flex-col gap-6">
                <div className="flex flex-col gap-2">
                  <h1
                    ref={headingRef}
                    tabIndex={-1}
                    className="text-xl font-medium outline-none"
                  >
                    <span key={title} className="block animate-fade">
                      {title}
                    </span>
                  </h1>
                  {description && (
                    <p
                      key={title}
                      className="animate-fade text-sm/relaxed text-muted-foreground"
                    >
                      {description}
                    </p>
                  )}
                </div>
                {children}
              </div>
            </main>
            <footer className="flex h-16 shrink-0 items-center justify-between gap-3 border-t">
              <div>{leadingAction}</div>
              <div className="flex animate-fade items-center gap-2">
                {trailingAction}
              </div>
            </footer>
          </div>
        </div>
      </div>
    </div>
  )
}
