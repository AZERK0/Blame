import * as React from "react"
import {
  AlertCircleIcon,
  BrainCircuitIcon,
  CheckCircle2Icon,
  DownloadIcon,
  LoaderCircleIcon,
  LogOutIcon,
  MonitorDownIcon,
  ServerCogIcon,
  PlugZapIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
  UserRoundIcon,
  type LucideIcon,
} from "lucide-react"

import { ManageModelsDialog } from "@/components/model/manage-models-dialog"
import {
  ConnectProviderDialog,
  ProviderSelectDialog,
} from "@/components/model/connect-provider-dialog"
import {
  ModelSelector,
  ModelProviderScope,
  ProviderMark,
  type ModelSelection,
  useModelSelection,
} from "@/components/model/model-selector"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { TooltipProvider } from "@/components/ui/tooltip"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useTheme } from "@/components/providers/theme-provider"
import { useCloudAuth } from "@/context/cloud-auth"
import {
  usePlatform,
  type DesktopUpdateStatus,
  type DesktopUpdatesClient,
} from "@/context/platform"
import { useSystemNotificationsEnabled } from "@/lib/system-notifications"
import { cn } from "@/lib/utils"
import { McpSettingsPanel } from "./mcp-settings-panel"
import { AccountPrivacyPanel } from "./account-privacy-panel"

type SettingsSectionId = "general" | "models" | "mcp" | "desktop" | "account"

type ThemeValue = "system" | "light" | "dark"

type SettingsSection = {
  description: string
  icon: LucideIcon
  id: SettingsSectionId
  title: string
}

type ProviderDialog =
  | { type: "providers" }
  | { type: "connect"; providerId: string }
  | { type: "models" }
  | undefined

const settingsSections: SettingsSection[] = [
  {
    description: "Appearance and interface preferences.",
    icon: Settings2Icon,
    id: "general",
    title: "General",
  },
  {
    description: "Connect your providers and choose the models Blame uses.",
    icon: BrainCircuitIcon,
    id: "models",
    title: "Models & Providers",
  },
  {
    description: "External tools and context for agents.",
    icon: ServerCogIcon,
    id: "mcp",
    title: "MCP Servers",
  },
  {
    description: "Desktop updates and local capabilities.",
    icon: MonitorDownIcon,
    id: "desktop",
    title: "Desktop",
  },
  {
    description: "Signed-in user and session actions.",
    icon: UserRoundIcon,
    id: "account",
    title: "Account",
  },
]

const fallbackStatus: DesktopUpdateStatus = {
  currentVersion: "development",
  phase: "unsupported",
  reason: "Updates are available only in the desktop app.",
}

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(46rem,88vh)] overflow-hidden p-0 sm:max-w-5xl">
        <TooltipProvider>
          <SettingsContent />
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  )
}

export function SettingsDialogButton({
  className,
  onClick,
}: {
  className?: string
  onClick(): void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label="Open settings"
      className={className}
      onClick={onClick}
    >
      <Settings2Icon />
      Settings
    </Button>
  )
}

function SettingsContent() {
  const auth = useCloudAuth()
  const [activeSection, setActiveSection] =
    React.useState<SettingsSectionId>("general")
  const accountDisabled = auth.status !== "authenticated"
  const visibleSection =
    accountDisabled && activeSection === "account" ? "general" : activeSection
  const section = settingsSections.find((item) => item.id === visibleSection)

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col md:flex-row">
      <SettingsSidebar
        accountDisabled={accountDisabled}
        activeSection={visibleSection}
        onSectionChange={setActiveSection}
      />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <SettingsSectionHeader section={section ?? settingsSections[0]} />
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 md:px-8">
          <SettingsSectionContent section={visibleSection} />
        </div>
      </main>
    </div>
  )
}

function SettingsSidebar({
  accountDisabled,
  activeSection,
  onSectionChange,
}: {
  accountDisabled: boolean
  activeSection: SettingsSectionId
  onSectionChange(section: SettingsSectionId): void
}) {
  return (
    <aside className="flex min-w-0 shrink-0 flex-col border-b bg-muted/30 md:w-60 md:border-r md:border-b-0">
      <DialogHeader className="px-4 pt-5 pb-3 text-left">
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>Configure Blame.</DialogDescription>
      </DialogHeader>
      <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible">
        {settingsSections.map((section) => (
          <SettingsNavItem
            key={section.id}
            active={section.id === activeSection}
            disabled={accountDisabled && section.id === "account"}
            section={section}
            onClick={() => onSectionChange(section.id)}
          />
        ))}
      </nav>
    </aside>
  )
}

function SettingsNavItem({
  active,
  disabled,
  onClick,
  section,
}: {
  active: boolean
  disabled: boolean
  onClick(): void
  section: SettingsSection
}) {
  const Icon = section.icon

  return (
    <button
      type="button"
      className={cn(
        "flex min-w-38 items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground md:min-w-0",
        active && "bg-foreground/10 text-foreground"
      )}
      disabled={disabled}
      title={disabled ? "Sign in to manage your account" : undefined}
      onClick={onClick}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{section.title}</span>
    </button>
  )
}

function SettingsSectionHeader({ section }: { section: SettingsSection }) {
  return (
    <header className="border-b px-5 py-5 md:px-8">
      <h2 className="font-heading text-xl font-semibold tracking-normal">
        {section.title}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {section.description}
      </p>
    </header>
  )
}

function SettingsSectionContent({ section }: { section: SettingsSectionId }) {
  if (section === "general") return <GeneralSettingsPanel />
  if (section === "mcp") return <McpSettingsPanel />
  if (section === "desktop") return <DesktopSettingsPanel />
  if (section === "account") return <AccountSettingsPanel />
  return (
    <ModelProviderScope>
      <AiSettingsPanel />
    </ModelProviderScope>
  )
}

function GeneralSettingsPanel() {
  return (
    <SettingsPanel>
      <SettingsGroup
        title="Interface"
        description="Adjust how Blame looks and how dense the controls feel."
      >
        <SettingsRow
          title="Theme"
          description="Choose the color mode used by the application."
        >
          <ThemeSelect />
        </SettingsRow>
        <SettingsRow
          title="Language"
          description="Blame currently ships with English interface text."
        >
          <LanguagePreview />
        </SettingsRow>
      </SettingsGroup>
    </SettingsPanel>
  )
}

function ThemeSelect() {
  const theme = useTheme()

  return (
    <Select
      value={theme.theme}
      onValueChange={(value) => theme.setTheme(themeValue(value))}
    >
      <SelectTrigger className="w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="system">System</SelectItem>
        <SelectItem value="light">Light</SelectItem>
        <SelectItem value="dark">Dark</SelectItem>
      </SelectContent>
    </Select>
  )
}

function LanguagePreview() {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium">English</span>
      <Badge variant="outline">Coming soon</Badge>
    </div>
  )
}

function ModelPreferences() {
  return (
    <SettingsGroup
      title="Default models"
      description="Choose which model handles each type of work."
    >
      <ModelPreferenceRow
        title="Agent model"
        description="Development sessions, backlog execution, and chat."
        role="agent"
      />
      <ModelPreferenceRow
        title="Alternative model"
        description="Project setup, security audits, and prompt optimization."
        role="alternative"
      />
    </SettingsGroup>
  )
}

function ModelPreferenceRow({
  title,
  description,
  role,
}: {
  title: string
  description: string
  role: "agent" | "alternative"
}) {
  return (
    <div className="grid min-w-0 gap-3 border-b py-4 last:border-b-0 @xl:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] @xl:items-center">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="min-w-0">
        <ModelSelector role={role} />
      </div>
    </div>
  )
}

function AiSettingsPanel() {
  const selection = useModelSelection({ role: "agent" })
  const [dialog, setDialog] = React.useState<ProviderDialog>()
  return (
    <div className="@container">
      <SettingsPanel>
        <ProviderConnections selection={selection} setDialog={setDialog} />
        <div className="border-t pt-5">
          <ModelPreferences />
        </div>
        <ProviderDialogs
          dialog={dialog}
          selection={selection}
          setDialog={setDialog}
        />
      </SettingsPanel>
    </div>
  )
}

function ProviderConnections({
  selection,
  setDialog,
}: {
  selection: ModelSelection
  setDialog(dialog: ProviderDialog): void
}) {
  const connectedProviders = selection.allProviders.filter((provider) =>
    selection.connectedProviderIDs.has(provider.id)
  )
  return (
    <SettingsGroup
      title="Provider connections"
      description="Link an account or API key to make its models available."
    >
      <ProvidersToolbar selection={selection} setDialog={setDialog} />
      <ProviderConnectionList
        connectedProviders={connectedProviders}
        selection={selection}
        setDialog={setDialog}
      />
    </SettingsGroup>
  )
}

function ProvidersToolbar({
  selection,
  setDialog,
}: {
  selection: ModelSelection
  setDialog(dialog: ProviderDialog): void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b py-3">
      <ProviderSummary selection={selection} />
      <ProviderToolbarActions selection={selection} setDialog={setDialog} />
    </div>
  )
}

function ProviderToolbarActions({
  selection,
  setDialog,
}: {
  selection: ModelSelection
  setDialog(dialog: ProviderDialog): void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <RefreshProvidersButton selection={selection} />
      <ManageModelsButton selection={selection} setDialog={setDialog} />
      <ConnectProviderButton selection={selection} setDialog={setDialog} />
    </div>
  )
}

function ManageModelsButton({
  selection,
  setDialog,
}: {
  selection: ModelSelection
  setDialog(dialog: ProviderDialog): void
}) {
  return (
    <Button
      type="button"
      variant="outline"
      disabled={!selection.serverReady}
      onClick={() => setDialog({ type: "models" })}
    >
      <SlidersHorizontalIcon />
      Manage models
    </Button>
  )
}

function ConnectProviderButton({
  selection,
  setDialog,
}: {
  selection: ModelSelection
  setDialog(dialog: ProviderDialog): void
}) {
  return (
    <Button
      type="button"
      disabled={!selection.serverReady}
      onClick={() => setDialog({ type: "providers" })}
    >
      <PlugZapIcon />
      Connect provider
    </Button>
  )
}

function RefreshProvidersButton({ selection }: { selection: ModelSelection }) {
  return (
    <Button
      type="button"
      variant="outline"
      disabled={!selection.serverReady || selection.loading}
      onClick={() => void selection.refreshProviders()}
    >
      {selection.loading ? (
        <LoaderCircleIcon className="animate-spin" />
      ) : (
        <RefreshCwIcon />
      )}
      Refresh
    </Button>
  )
}

function ProviderSummary({ selection }: { selection: ModelSelection }) {
  if (!selection.serverReady) {
    return <StatusText title="Model service unavailable" tone="muted" />
  }

  if (selection.loading) {
    return <StatusText title="Loading providers" tone="muted" />
  }

  return (
    <StatusText
      title={`${selection.connectedProviderIDs.size} connected provider${selection.connectedProviderIDs.size === 1 ? "" : "s"}`}
      tone={selection.connectedProviderIDs.size ? "success" : "muted"}
    />
  )
}

function ProviderConnectionList({
  connectedProviders,
  selection,
  setDialog,
}: {
  connectedProviders: ModelSelection["allProviders"]
  selection: ModelSelection
  setDialog(dialog: ProviderDialog): void
}) {
  if (!selection.serverReady)
    return <ProviderEmptyState selection={selection} />

  if (selection.loading)
    return <EmptySettingsState message="Loading provider connections…" />
  if (!connectedProviders.length) {
    return (
      <EmptySettingsState message="Connect your first provider to choose a default model below." />
    )
  }

  return (
    <div>
      {connectedProviders.map((provider) => (
        <ProviderConnectionRow
          key={provider.id}
          provider={provider}
          selection={selection}
          onManage={() => openProviderDialog(provider.id, setDialog)}
        />
      ))}
    </div>
  )
}

function ProviderEmptyState({ selection }: { selection: ModelSelection }) {
  return <EmptySettingsState message={selection.emptyMessage} />
}

function ProviderConnectionRow({
  onManage,
  provider,
  selection,
}: {
  onManage(): void
  provider: ModelSelection["allProviders"][number]
  selection: ModelSelection
}) {
  const connectionCount = providerCredentialCount(selection, provider.id)

  return (
    <div className="flex flex-col gap-3 border-b py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <ProviderMark provider={provider} />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{provider.name}</div>
          <div className="truncate text-sm text-muted-foreground">
            {providerConnectionLabel(connectionCount)}
          </div>
        </div>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onManage}>
        Manage
      </Button>
    </div>
  )
}

function providerCredentialCount(
  selection: ModelSelection,
  providerId: string
) {
  return selection.credentials.filter((item) => item.providerId === providerId)
    .length
}

function openProviderDialog(
  providerId: string,
  setDialog: (dialog: ProviderDialog) => void
) {
  setDialog({ type: "connect", providerId })
}

function ProviderDialogs({
  dialog,
  selection,
  setDialog,
}: {
  dialog: ProviderDialog
  selection: ModelSelection
  setDialog(dialog: ProviderDialog): void
}) {
  return (
    <>
      <ProviderPickerDialog
        dialog={dialog}
        selection={selection}
        setDialog={setDialog}
      />
      <ProviderConnectionDialog
        dialog={dialog}
        selection={selection}
        setDialog={setDialog}
      />
      <ModelVisibilityDialog
        dialog={dialog}
        selection={selection}
        setDialog={setDialog}
      />
    </>
  )
}

function ProviderPickerDialog({
  dialog,
  selection,
  setDialog,
}: {
  dialog: ProviderDialog
  selection: ModelSelection
  setDialog(dialog: ProviderDialog): void
}) {
  return (
    <ProviderSelectDialog
      open={dialog?.type === "providers"}
      selection={selection}
      onConnect={(providerId) => setDialog({ type: "connect", providerId })}
      onOpenChange={(open) =>
        setDialog(open ? { type: "providers" } : undefined)
      }
    />
  )
}

function ProviderConnectionDialog({
  dialog,
  selection,
  setDialog,
}: {
  dialog: ProviderDialog
  selection: ModelSelection
  setDialog(dialog: ProviderDialog): void
}) {
  return (
    <ConnectProviderDialog
      providerID={dialog?.type === "connect" ? dialog.providerId : undefined}
      selection={selection}
      onBack={() => setDialog({ type: "providers" })}
      onOpenChange={(open) => {
        if (!open) setDialog(undefined)
      }}
    />
  )
}

function ModelVisibilityDialog({
  dialog,
  selection,
  setDialog,
}: {
  dialog: ProviderDialog
  selection: ModelSelection
  setDialog(dialog: ProviderDialog): void
}) {
  return (
    <ManageModelsDialog
      open={dialog?.type === "models"}
      selection={selection}
      onConnectProvider={() => setDialog({ type: "providers" })}
      onOpenChange={(open) => setDialog(open ? { type: "models" } : undefined)}
    />
  )
}

function DesktopSettingsPanel() {
  const platform = usePlatform()
  const updates = useDesktopUpdates(platform.updates)

  return (
    <SettingsPanel>
      <DesktopUpdatesGroup platform={platform} updates={updates} />
      <DesktopIntegrationGroup platform={platform} />
    </SettingsPanel>
  )
}

function DesktopUpdatesGroup({
  platform,
  updates,
}: {
  platform: ReturnType<typeof usePlatform>
  updates: ReturnType<typeof useDesktopUpdates>
}) {
  return (
    <SettingsGroup
      title="Updates"
      description="Follow the desktop release state and install updates when ready."
    >
      <UpdateOverview status={updates.status} />
      <VersionGrid status={updates.status} />
      {updates.status.phase === "downloading" ? (
        <DownloadProgress progress={updates.status.progress ?? 0} />
      ) : null}
      <UpdateActions
        status={updates.status}
        updates={platform.updates}
        run={updates.run}
      />
    </SettingsGroup>
  )
}

function DesktopIntegrationGroup({
  platform,
}: {
  platform: ReturnType<typeof usePlatform>
}) {
  const [notificationsEnabled, setNotificationsEnabled] =
    useSystemNotificationsEnabled()

  return (
    <SettingsGroup
      title="Desktop integration"
      description="Check which native features are available in this runtime."
    >
      <SettingsRow
        title="System notifications"
        description="Show desktop alerts when agents need attention or finish a response."
      >
        <Switch
          aria-label="Toggle system notifications"
          checked={notificationsEnabled}
          disabled={!platform.systemNotifications}
          onCheckedChange={setNotificationsEnabled}
        />
      </SettingsRow>
      <CapabilityRow label="Updates" enabled={!!platform.updates} />
      <CapabilityRow label="Workspace access" enabled={!!platform.workspace} />
      <CapabilityRow label="Terminal runner" enabled={!!platform.terminal} />
      <CapabilityRow
        label="System notifications"
        enabled={!!platform.systemNotifications}
      />
      <CapabilityRow
        label="Preview browser"
        enabled={!!platform.previewBrowser}
      />
    </SettingsGroup>
  )
}

function AccountSettingsPanel() {
  const auth = useCloudAuth()
  const user = auth.user

  return (
    <SettingsPanel>
      <SettingsGroup
        title="Session"
        description="Review the signed-in user and end the current session."
      >
        <SettingsRow
          title={user?.fullName || user?.email || "Signed in"}
          description={user?.email ?? "Your account is authenticated."}
        >
          <Button
            type="button"
            variant="destructive"
            onClick={() => void auth.logout()}
          >
            <LogOutIcon />
            Log out
          </Button>
        </SettingsRow>
      </SettingsGroup>
      <AccountPrivacyPanel />
    </SettingsPanel>
  )
}

function useDesktopUpdates(updates: DesktopUpdatesClient | undefined) {
  const [status, setStatus] =
    React.useState<DesktopUpdateStatus>(fallbackStatus)
  const run = useDesktopUpdateRunner(setStatus)

  useDesktopUpdateSubscription(updates, setStatus)

  return { run, status }
}

function useDesktopUpdateSubscription(
  updates: DesktopUpdatesClient | undefined,
  setStatus: React.Dispatch<React.SetStateAction<DesktopUpdateStatus>>
) {
  React.useEffect(() => {
    if (!updates) {
      setStatus(fallbackStatus)
      return undefined
    }

    let active = true
    void updates.getStatus().then((nextStatus) => {
      if (active) setStatus(nextStatus)
    })
    const unsubscribe = updates.onStatus(setStatus)

    return () => {
      active = false
      unsubscribe()
    }
  }, [setStatus, updates])
}

function useDesktopUpdateRunner(
  setStatus: React.Dispatch<React.SetStateAction<DesktopUpdateStatus>>
) {
  return React.useCallback(
    async (action: () => Promise<DesktopUpdateStatus>) => {
      try {
        setStatus(await action())
      } catch (error) {
        setStatus((current) => updateErrorStatus(current, error))
      }
    },
    [setStatus]
  )
}

function UpdateOverview({ status }: { status: DesktopUpdateStatus }) {
  const summary = updateSummary(status)

  return (
    <div className="flex flex-col gap-3 border-b py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 gap-3">
        <span className={cn("mt-0.5 text-muted-foreground", summary.iconClass)}>
          <UpdateStatusIcon status={status} />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium">{summary.title}</div>
          <p className="mt-1 text-sm text-muted-foreground">
            {summary.description}
          </p>
        </div>
      </div>
      <UpdateBadge status={status} />
    </div>
  )
}

function UpdateStatusIcon({ status }: { status: DesktopUpdateStatus }) {
  const className = cn(
    "size-5",
    status.phase === "checking" && "animate-spin",
    status.phase === "downloading" && "animate-spin"
  )

  if (status.phase === "error") return <AlertCircleIcon className={className} />
  if (status.phase === "available")
    return <DownloadIcon className={className} />
  if (status.phase === "checking" || status.phase === "downloading") {
    return <LoaderCircleIcon className={className} />
  }
  if (status.phase === "downloaded" || status.phase === "not-available") {
    return <CheckCircle2Icon className={className} />
  }
  return <MonitorDownIcon className={className} />
}

function VersionGrid({ status }: { status: DesktopUpdateStatus }) {
  return (
    <div className="grid gap-4 border-b py-4 sm:grid-cols-2">
      <VersionCell label="Current version" value={status.currentVersion} />
      <VersionCell
        label="Latest version"
        value={status.latestVersion ?? "Not checked"}
      />
    </div>
  )
}

function UpdateActions({
  run,
  status,
  updates,
}: {
  run: (action: () => Promise<DesktopUpdateStatus>) => Promise<void>
  status: DesktopUpdateStatus
  updates: DesktopUpdatesClient | undefined
}) {
  const busy = status.phase === "checking" || status.phase === "downloading"

  return (
    <div className="flex flex-wrap gap-2 py-4">
      <CheckUpdateButton
        busy={busy}
        run={run}
        status={status}
        updates={updates}
      />
      <DownloadUpdateButton run={run} status={status} updates={updates} />
      <InstallUpdateButton run={run} status={status} updates={updates} />
    </div>
  )
}

function CheckUpdateButton({
  busy,
  run,
  status,
  updates,
}: {
  busy: boolean
  run: (action: () => Promise<DesktopUpdateStatus>) => Promise<void>
  status: DesktopUpdateStatus
  updates: DesktopUpdatesClient | undefined
}) {
  return (
    <Button
      type="button"
      variant={status.phase === "idle" ? "default" : "outline"}
      disabled={!updates || busy}
      onClick={() => updates && void run(updates.check)}
    >
      <RefreshCwIcon />
      Check
    </Button>
  )
}

function DownloadUpdateButton({
  run,
  status,
  updates,
}: {
  run: (action: () => Promise<DesktopUpdateStatus>) => Promise<void>
  status: DesktopUpdateStatus
  updates: DesktopUpdatesClient | undefined
}) {
  if (status.phase !== "available" && status.phase !== "downloading")
    return null

  return (
    <Button
      type="button"
      disabled={!updates || status.phase !== "available"}
      onClick={() => updates && void run(updates.download)}
    >
      <DownloadIcon />
      Download
    </Button>
  )
}

function InstallUpdateButton({
  run,
  status,
  updates,
}: {
  run: (action: () => Promise<DesktopUpdateStatus>) => Promise<void>
  status: DesktopUpdateStatus
  updates: DesktopUpdatesClient | undefined
}) {
  if (status.phase !== "downloaded") return null

  return (
    <Button
      type="button"
      disabled={!updates}
      onClick={() => updates && void run(updates.install)}
    >
      <RotateCcwIcon />
      Restart and install
    </Button>
  )
}

function DownloadProgress({ progress }: { progress: number }) {
  const percent = Math.max(0, Math.min(100, progress))

  return (
    <div className="border-b py-4">
      <div className="flex justify-between text-sm">
        <span className="font-medium">Downloading update</span>
        <span className="text-muted-foreground">{Math.round(percent)}%</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

function CapabilityRow({
  enabled,
  label,
}: {
  enabled: boolean
  label: string
}) {
  return (
    <SettingsRow
      title={label}
      description={enabled ? "Available" : "Unavailable"}
    >
      <Badge variant={enabled ? "secondary" : "outline"}>
        {enabled ? "Ready" : "Missing"}
      </Badge>
    </SettingsRow>
  )
}

function SettingsPanel({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-5 py-6">{children}</div>
}

function SettingsGroup({
  children,
  description,
  title,
}: {
  children: React.ReactNode
  description: string
  title: string
}) {
  return (
    <section>
      <div className="mb-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div>{children}</div>
    </section>
  )
}

function SettingsRow({
  children,
  description,
  title,
}: {
  children: React.ReactNode
  description: string
  title: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 border-b py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{title}</div>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex min-w-0 shrink-0 items-center gap-2 sm:justify-end">
        {children}
      </div>
    </div>
  )
}

function StatusText({
  title,
  tone,
}: {
  title: string
  tone: "muted" | "success"
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className={cn(
          "size-2 rounded-full",
          tone === "success" ? "bg-emerald-500" : "bg-muted-foreground"
        )}
      />
      <span className="font-medium">{title}</span>
    </div>
  )
}

function EmptySettingsState({ message }: { message: string }) {
  return (
    <div className="border-b py-8 text-center text-sm text-muted-foreground">
      {message}
    </div>
  )
}

function VersionCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-medium">{value}</div>
    </div>
  )
}

function UpdateBadge({ status }: { status: DesktopUpdateStatus }) {
  if (status.phase === "available") return <Badge>Available</Badge>
  if (status.phase === "downloaded") return <Badge>Ready</Badge>
  if (status.phase === "error")
    return <Badge variant="destructive">Error</Badge>
  if (status.phase === "unsupported")
    return <Badge variant="outline">Unavailable</Badge>
  if (status.phase === "checking" || status.phase === "downloading")
    return <Badge variant="secondary">Working</Badge>
  if (status.phase === "not-available")
    return <Badge variant="secondary">Current</Badge>
  return <Badge variant="outline">Idle</Badge>
}

function updateSummary(status: DesktopUpdateStatus) {
  if (status.phase === "error") {
    return {
      description: status.error ?? "Unable to check for updates.",
      iconClass: "text-destructive",
      title: "Update check failed",
    }
  }

  if (status.phase === "unsupported") {
    return {
      description: status.reason ?? "Updates are unavailable for this build.",
      iconClass: "",
      title: "Updates unavailable",
    }
  }

  if (status.phase === "available") {
    return {
      description: "Download the update now or keep working on this version.",
      iconClass: "text-primary",
      title: `Version ${status.latestVersion} is available`,
    }
  }

  return runningUpdateSummary(status)
}

function runningUpdateSummary(status: DesktopUpdateStatus) {
  if (status.phase === "downloaded") {
    return {
      description: `Restart Blame to install version ${status.latestVersion}.`,
      iconClass: "text-emerald-500",
      title: "Update downloaded",
    }
  }

  if (status.phase === "downloading") {
    return {
      description: "The update package is downloading in the background.",
      iconClass: "text-primary",
      title: "Downloading update",
    }
  }

  if (status.phase === "checking") {
    return {
      description: "Blame is checking the latest desktop release.",
      iconClass: "text-primary",
      title: "Checking for updates",
    }
  }

  return idleUpdateSummary(status)
}

function idleUpdateSummary(status: DesktopUpdateStatus) {
  if (status.phase === "not-available") {
    return {
      description: "No newer desktop release is available.",
      iconClass: "text-emerald-500",
      title: "Blame is up to date",
    }
  }

  return {
    description: "Check manually when you want to look for a new release.",
    iconClass: "",
    title: "Manual updates",
  }
}

function updateErrorStatus(
  status: DesktopUpdateStatus,
  error: unknown
): DesktopUpdateStatus {
  return {
    ...status,
    error: error instanceof Error ? error.message : "Unable to update Blame.",
    phase: "error",
  }
}

function providerConnectionLabel(count: number) {
  if (count === 1) return "1 connection"
  return `${count} connections`
}

function themeValue(value: string): ThemeValue {
  if (value === "light" || value === "dark") return value
  return "system"
}
