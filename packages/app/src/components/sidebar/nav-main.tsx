import { AppLink } from "@/components/navigation/app-link"
import { QuickChatHistory } from "@/components/sidebar/quick-chat-history"
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
                isActive={pathname === item.url}
              >
                <AppLink href={item.url}>
                  {item.icon}
                  <span>{item.title}</span>
                </AppLink>
              </SidebarMenuButton>
              {item.url === "/chats" ? <QuickChatHistory /> : null}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
