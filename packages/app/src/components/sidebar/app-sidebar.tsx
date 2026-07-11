import * as React from "react"

import { NavMain } from "@/components/sidebar/nav-main"
import { NavSecondary } from "@/components/sidebar/nav-secondary"
import { NavUser } from "@/components/sidebar/nav-user"
import { ProjectSelector } from "@/components/sidebar/project-selector"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useCloudAuth } from "@/context/cloud-auth"
import {
  CircleHelpIcon,
  ClipboardCheckIcon, CloudUploadIcon,
  GitBranchIcon,
  MessageCircleIcon,
  SearchIcon,
  Settings2Icon, ShieldCheckIcon,
  Table2Icon,
  UsersIcon,
} from "lucide-react"

const data = {
  navMain: [
    {
      title: "Backlog",
      url: "/backlog",
      icon: <Table2Icon />,
    },
    {
      title: "Chat",
      url: "/chat",
      icon: <MessageCircleIcon />,
    },
    {
      title: "Git",
      url: "/git",
      icon: <GitBranchIcon />,
    },
  ],
  navSecondary: [
    {
      title: "Settings",
      url: "/settings",
      icon: <Settings2Icon />,
    },
    {
      title: "Get Help",
      url: "/help",
      icon: <CircleHelpIcon />,
    },
    {
      title: "Search",
      url: "/search",
      icon: <SearchIcon />,
    },
  ],
  project: [
    {
      title: "Code Practices",
      url: "/practices",
      icon: <ClipboardCheckIcon />,
    },
    {
      title: "Security Audit",
      url: "/security",
      icon: <ShieldCheckIcon />,
    },
    {
      title: "Deploy",
      url: "/deploy",
      icon: <CloudUploadIcon />,
    },
  ],
}

export function AppSidebar({
  pathname,
  ...props
}: React.ComponentProps<typeof Sidebar> & { pathname: string }) {
  const auth = useCloudAuth()

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <ProjectSelector />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} pathname={pathname} />
        <NavMain items={data.project} label="Project" pathname={pathname} />
        <NavSecondary
          items={data.navSecondary}
          pathname={pathname}
          className="mt-auto"
        />
      </SidebarContent>
      <SidebarFooter>
        {auth.user ? <NavUser user={auth.user} onLogout={auth.logout} /> : null}
      </SidebarFooter>
    </Sidebar>
  )
}
