import * as React from "react"

import { BacklogPage } from "@/pages/backlog/page"
import { BacklogStatusPipPage } from "@/pages/backlog/status-pip-page"
import { ChatPage } from "@/pages/chat/page"
import { GitPage } from "@/pages/git/page"
import { PracticesPage } from "@/pages/practices/page"
import { BacklogStoreProvider } from "@/components/backlog/data/backlog-store"
import { QuickChatStoreProvider } from "@/components/chat/data/quick-chat-store"
import { ConnectScreen } from "@/components/onboarding/connect-screen"
import { AiPreferencesSetupScreen } from "@/components/onboarding/ai-preferences-setup-screen"
import {
  navigate,
  navigationPathname,
  navigationPreviousPathname,
  subscribeToNavigation,
} from "@/components/navigation/navigation"
import { LoadingScreen } from "@/components/onboarding/loading-screen"
import { LicenseScreen } from "@/components/onboarding/license-screen"
import { WelcomeScreen } from "@/components/onboarding/welcome-screen"
import { ProjectInitializationRunner } from "@/components/project-initialization/project-initialization-runner"
import { ProjectCodePracticesRunner } from "@/components/practices/project-code-practices-runner"
import { UpdateStartupNotifier } from "@/components/updates/update-startup-notifier"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useCloudAuth } from "@/context/cloud-auth"
import { usePlatform } from "@/context/platform"
import { useProjects } from "@/context/projects"
import { AppLayout } from "@/layouts/app-layout"
import { SettingsDialog } from "@/pages/settings/page"
import { AccountPrivacyPage } from "@/pages/account-privacy/page"
import { AccountClosureReceiptPage } from "@/pages/account-privacy/account-closure-receipt-page"
import {
  getAccountClosureReceipt,
  subscribeToAccountClosureReceipt,
} from "@/lib/account-closure-receipt-storage"
import { appWindowRole } from "@/lib/app-window-role"

const settingsPath = "/settings"
const accountPrivacyPath = "/account/privacy"
const backlogStatusPipPath = "/backlog-status-pip"

const routes = [
  { path: "/backlog", title: "Backlog", element: <BacklogPage /> },
  {
    path: backlogStatusPipPath,
    title: "Active User Stories",
    element: <BacklogStatusPipPage />,
  },
  { path: "/chat", title: "Chat", element: <ChatPage /> },
  { path: "/git", title: "Git", element: <GitPage /> },
  { path: "/practices", title: "Code Practices", element: <PracticesPage /> },
  {
    path: "/security",
    title: "Security Audit",
    element: <RoutePage title="Security Audit" />,
  },
  { path: "/deploy", title: "Deploy", element: <RoutePage title="Deploy" /> },
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
  { path: "/help", title: "Get Help", element: <RoutePage title="Get Help" /> },
  { path: "/search", title: "Search", element: <RoutePage title="Search" /> },
]

function resolveRoute(pathname: string) {
  return routes.find((route) => route.path === pathname) ?? routes[0]
}

function RoutePage({ title }: { title: string }) {
  return (
    <div className="flex flex-1 flex-col gap-4 px-4 pt-[calc(var(--header-height)+1rem)] pb-4 lg:px-6 lg:pt-[calc(var(--header-height)+1.5rem)] lg:pb-6">
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
  const platform = usePlatform()
  const projects = useProjects()
  const closureReceipt = React.useSyncExternalStore(
    subscribeToAccountClosureReceipt,
    getAccountClosureReceipt,
    getAccountClosureReceipt
  )
  const pathname = React.useSyncExternalStore(
    subscribeToNavigation,
    navigationPathname,
    () => "/backlog"
  )
  const previousPathname = React.useSyncExternalStore(
    subscribeToNavigation,
    navigationPreviousPathname,
    () => "/backlog"
  )
  const route = resolveRoute(pathname)
  const settingsOpen = pathname === settingsPath
  const accountPrivacyOpen = pathname === accountPrivacyPath
  const statusPipOpen = pathname === backlogStatusPipPath
  const previousRoute = resolvePreviousRoute(previousPathname)
  const activeRoute = settingsOpen ? previousRoute : route
  const windowRole = appWindowRole({
    activeProject: projects.activeProject,
    accountPrivacyOpen,
    aiPreferences: auth.aiPreferences,
    authStatus: auth.status,
    licensed: auth.license?.licensed ?? false,
    statusPipOpen,
  })

  React.useEffect(() => {
    if (!windowRole) return
    void platform.windowControls?.setPresentation({
      pathname,
      role: windowRole,
    })
  }, [pathname, platform.windowControls, windowRole])

  function closeSettings(open: boolean) {
    if (!open) navigate(activeRoute.path)
  }

  if (auth.status === "loading") return <LoadingScreen />
  if (auth.status === "unauthenticated" && closureReceipt) {
    return (
      <TooltipProvider>
        <AccountClosureReceiptPage receipt={closureReceipt} />
        <Toaster />
      </TooltipProvider>
    )
  }
  if (auth.status === "unauthenticated") return <ConnectScreen />
  if (accountPrivacyOpen) {
    return (
      <TooltipProvider>
        <AccountPrivacyPage />
        <Toaster />
      </TooltipProvider>
    )
  }
  if (!auth.license?.licensed) return <LicenseScreen />
  if (statusPipOpen) {
    return (
      <TooltipProvider>
        <BacklogStatusPipPage />
        <Toaster />
      </TooltipProvider>
    )
  }
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
      <BacklogStoreProvider>
        <QuickChatStoreProvider>
          <ProjectInitializationRunner />
          <ProjectCodePracticesRunner />
          <UpdateStartupNotifier />
          <AppLayout pathname={pathname} title={activeRoute.title}>
            {activeRoute.element}
          </AppLayout>
          <SettingsDialog open={settingsOpen} onOpenChange={closeSettings} />
          <Toaster />
        </QuickChatStoreProvider>
      </BacklogStoreProvider>
    </TooltipProvider>
  )
}

function resolvePreviousRoute(pathname: string) {
  if (pathname === settingsPath) return routes[0]
  return resolveRoute(pathname)
}

export default App
