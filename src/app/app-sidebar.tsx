import {
  DashboardSquare01Icon,
  Database01Icon,
  Home01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"

import { DavisMark } from "@/components/davis-mark"
import { SoundToggle } from "@/components/sound-toggle"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

export type View = "home" | "data" | "pages" | "settings"

export const VIEW_LABELS: Record<View, string> = {
  home: "Home",
  data: "Data",
  pages: "Pages",
  settings: "Settings",
}

const MAIN_ITEMS: { view: View; icon: IconSvgElement }[] = [
  { view: "home", icon: Home01Icon },
  { view: "data", icon: Database01Icon },
  { view: "pages", icon: DashboardSquare01Icon },
]

type AppSidebarProps = {
  view: View
  onViewChange: (view: View) => void
}

export function AppSidebar({ view, onViewChange }: AppSidebarProps) {
  const { state } = useSidebar()

  return (
    <Sidebar
      variant="inset"
      role="navigation"
      aria-label="Main"
      inert={state === "collapsed"}
    >
      <SidebarHeader
        data-tauri-drag-region="deep"
        className="h-8 flex-row items-center justify-end px-2 py-0"
      >
        <DavisMark className="size-4 text-foreground" />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu className="gap-0">
            {MAIN_ITEMS.map((item) => (
              <SidebarMenuItem key={item.view}>
                <SidebarMenuButton
                  isActive={view === item.view}
                  onClick={() => onViewChange(item.view)}
                >
                  <HugeiconsIcon icon={item.icon} strokeWidth={1.5} />
                  {VIEW_LABELS[item.view]}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="flex-row items-center gap-1">
        <SidebarMenu className="min-w-0 flex-1">
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={view === "settings"}
              onClick={() => onViewChange("settings")}
            >
              <HugeiconsIcon icon={Settings01Icon} strokeWidth={1.5} />
              {VIEW_LABELS.settings}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SoundToggle />
      </SidebarFooter>
    </Sidebar>
  )
}
