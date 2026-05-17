import { SiteHeader } from "@/components/layout/site-header"
import { AppSidebar } from "@/components/sidebar/app-sidebar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { useProjects } from "@/context/projects"
import { projectColorValue } from "@/lib/projects"

export function AppLayout({
  children,
  pathname,
  title,
}: {
  children: React.ReactNode
  pathname: string
  title: string
}) {
  const projects = useProjects()
  const haloColor = projectColorValue(projects.activeProject?.color)

  return (
    <SidebarProvider
      className="relative isolate overflow-hidden bg-transparent"
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <div
        aria-hidden="true"
        className="pointer-events-none fixed top-0 left-0 z-0 h-72 w-96 -translate-x-24 -translate-y-28 blur-3xl"
        style={{
          background: `radial-gradient(circle at center, ${haloColor} 0%, transparent 68%)`,
          opacity: 0.42,
        }}
      />
      <AppSidebar pathname={pathname} variant="inset" />
      <SidebarInset className="z-[1] min-w-0 overflow-hidden">
        <SiteHeader title={title} />
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}
