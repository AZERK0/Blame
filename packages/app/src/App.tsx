import * as React from "react"

import { BacklogPage } from "@/pages/backlog/page"
import { PracticesPage } from "@/pages/practices/page"
import { QuickChatPage } from "@/components/chat/quick-chat-page"
import { ConnectScreen } from "@/components/onboarding/connect-screen"
import { AiPreferencesSetupScreen } from "@/components/onboarding/ai-preferences-setup-screen"
import {
  navigationPathname,
  subscribeToNavigation,
} from "@/components/navigation/navigation"
import { LoadingScreen } from "@/components/onboarding/loading-screen"
import { WelcomeScreen } from "@/components/onboarding/welcome-screen"
import { ProjectInitializationRunner } from "@/components/project-initialization/project-initialization-runner"
import { UpdateStartupNotifier } from "@/components/updates/update-startup-notifier"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useCloudAuth } from "@/context/cloud-auth"
import { useProjects } from "@/context/projects"
import { AppLayout } from "@/layouts/app-layout"
import { SettingsPage } from "@/pages/settings/page"

const routes = [
  { path: "/backlog", title: "Backlog", element: <BacklogPage /> },
  { path: "/chats", title: "Chats", element: <QuickChatPage /> },
  { path: "/git", title: "Git", element: <RoutePage title="Git" /> },
  { path: "/practices", title: "Code Practices", element: <PracticesPage /> },
  { path: "/team", title: "Team", element: <RoutePage title="Team" /> },
  {
    path: "/data-library",
    title: "Data Library",
    element: <RoutePage title="Data Library" />,
  },
  {
    path: "/reports",
    title: "Reports",
    element: <RoutePage title="Reports" />,
  },
  {
    path: "/word-assistant",
    title: "Word Assistant",
    element: <RoutePage title="Word Assistant" />,
  },
  {
    path: "/settings",
    title: "Settings",
    element: <SettingsPage />,
  },
  { path: "/help", title: "Get Help", element: <RoutePage title="Get Help" /> },
  { path: "/search", title: "Search", element: <RoutePage title="Search" /> },
]

function resolveRoute(pathname: string) {
  return routes.find((route) => route.path === pathname) ?? routes[0]
}

function RoutePage({ title }: { title: string }) {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
      <div className="rounded-lg border bg-card p-6 text-card-foreground">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Cette page est branchee sur sa route.
        </p>
      </div>
    </div>
  )
}

export function App() {
  const auth = useCloudAuth()
  const projects = useProjects()
  const pathname = React.useSyncExternalStore(
    subscribeToNavigation,
    navigationPathname,
    () => "/backlog"
  )
  const route = resolveRoute(pathname)

  if (auth.status === "loading") return <LoadingScreen />
  if (auth.status === "unauthenticated") return <ConnectScreen />
  if (auth.aiPreferences === null) {
    return (
      <TooltipProvider>
        <AiPreferencesSetupScreen />
        <Toaster />
      </TooltipProvider>
    )
  }
  if (!projects.activeProject) return <WelcomeScreen />

  return (
    <TooltipProvider>
      <ProjectInitializationRunner />
      <UpdateStartupNotifier />
      <AppLayout pathname={route.path} title={route.title}>
        {route.element}
      </AppLayout>
      <Toaster />
    </TooltipProvider>
  )
}

export default App
