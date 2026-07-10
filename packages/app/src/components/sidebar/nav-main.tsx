import { AppLink } from "@/components/navigation/app-link"
import * as React from "react"
import {
  selectBacklogStory,
  selectedBacklogStoryId,
  subscribeToBacklogStorySelection,
} from "@/components/backlog/data/backlog-navigation"
import { quickChatSelectedEvent } from "@/components/chat/data/quick-chat-data"
import { useQuickChatStore } from "@/components/chat/data/quick-chat-store"
import { QuickChatHistory } from "@/components/sidebar/quick-chat-history"
import { ActiveBacklogStories } from "@/components/sidebar/active-backlog-stories"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export function NavMain({
  items,
  label,
  pathname,
}: {
  items: {
    title: string
    url: string
    icon?: React.ReactNode
  }[]
  label?: string
  pathname: string
}) {
  const quickChats = useQuickChatStore()
  const selectedStoryId = React.useSyncExternalStore(
    subscribeToBacklogStorySelection,
    selectedBacklogStoryId
  )

  return (
    <SidebarGroup>
      {label ? <SidebarGroupLabel>{label}</SidebarGroupLabel> : null}
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                asChild
                tooltip={item.title}
                isActive={
                  pathname === item.url &&
                  (item.url !== "/chats" || !quickChats.activeId) &&
                  (item.url !== "/backlog" || !selectedStoryId)
                }
              >
                <AppLink
                  href={item.url}
                  onClick={() => {
                    if (item.url === "/chats") {
                      quickChats.setActiveId(undefined)
                      window.dispatchEvent(new Event(quickChatSelectedEvent))
                    }
                    if (item.url === "/backlog") selectBacklogStory(undefined)
                  }}
                >
                  {item.icon}
                  <span>{item.title}</span>
                </AppLink>
              </SidebarMenuButton>
              {item.url === "/chats" ? (
                <QuickChatHistory pathname={pathname} />
              ) : null}
              {item.url === "/backlog" ? (
                <ActiveBacklogStories pathname={pathname} />
              ) : null}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
