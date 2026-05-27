import * as React from "react"
import { FolderIcon, GitMergeIcon, TerminalIcon } from "lucide-react"

import type {
  BacklogColumnId,
  UserStory,
} from "@/components/backlog/data/backlog-data"
import { DevelopmentCodePanel } from "@/components/backlog/development/development-code-panel"
import { DevelopmentTerminal } from "@/components/backlog/development/development-terminal"
import type { UserStoryDevelopmentTab } from "@/components/backlog/shared/backlog-types"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar"

const developmentTabs = [
  { id: "files", label: "Files", icon: FolderIcon },
  { id: "diff", label: "Diff", icon: GitMergeIcon },
  { id: "terminal", label: "Terminal", icon: TerminalIcon },
] satisfies {
  id: UserStoryDevelopmentTab
  label: string
  icon: React.ComponentType<{ className?: string }>
}[]

const rootDevelopmentStatuses = new Set<BacklogColumnId>(["backlog", "ready"])

export function DevelopmentContent({
  initialFilePath,
  onTabChange,
  status,
  tab,
  userStory,
}: {
  initialFilePath?: string
  onTabChange: (tab: UserStoryDevelopmentTab) => void
  status: BacklogColumnId
  tab: UserStoryDevelopmentTab
  userStory?: UserStory
}) {
  const tabs = rootDevelopmentStatuses.has(status)
    ? developmentTabs.filter((item) => item.id === "files")
    : status === "done"
      ? developmentTabs.filter((item) => item.id === "diff")
      : developmentTabs

  const activeTab = tabs.some((item) => item.id === tab) ? tab : tabs[0].id

  React.useEffect(() => {
    if (activeTab === tab) return
    onTabChange(activeTab)
  }, [activeTab, onTabChange, tab])

  return (
    <SidebarProvider
      className="h-full min-h-0 bg-transparent"
      style={
        {
          "--sidebar-width": "12rem",
        } as React.CSSProperties
      }
    >
      <Sidebar collapsible="none" className="border-r bg-muted/20">
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Code</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {tabs.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={activeTab === item.id}
                      onClick={() => onTabChange(item.id)}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset className="min-h-0 min-w-0 bg-transparent">
        {activeTab === "files" && (
          <DevelopmentCodePanel
            fallbackToProjectRoot={rootDevelopmentStatuses.has(status)}
            initialFilePath={initialFilePath}
            mode="files"
            userStory={userStory}
          />
        )}
        {activeTab === "diff" && (
          <DevelopmentCodePanel mode="diff" userStory={userStory} />
        )}
        {activeTab === "terminal" && (
          <DevelopmentTerminal userStory={userStory} />
        )}
      </SidebarInset>
    </SidebarProvider>
  )
}
