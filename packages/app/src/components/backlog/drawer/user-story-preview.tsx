import * as React from "react"
import {
  AlertTriangleIcon,
  ExternalLinkIcon,
  LockIcon,
  LoaderCircleIcon,
  MonitorIcon,
  PlayIcon,
  RefreshCwIcon,
} from "lucide-react"

import type { UserStory } from "@/components/backlog/data/backlog-data"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { usePlatform } from "@/context/platform"

type PreviewState = "loading" | "loaded" | "error"
type PreviewLoad = {
  key: string
  location?: string
  locationBlocked?: boolean
  state: PreviewState
}

export function UserStoryPreview({ userStory }: { userStory?: UserStory }) {
  const platform = usePlatform()
  const [recoveredPreviewUrl, setRecoveredPreviewUrl] = React.useState<
    string | undefined
  >()
  const [previewLoad, setPreviewLoad] = React.useState<PreviewLoad>({
    key: "",
    state: "loading",
  })
  const [reloadKey, setReloadKey] = React.useState(0)
  const frameRef = React.useRef<HTMLIFrameElement>(null)
  const locationIntervalRef = React.useRef<number | undefined>(undefined)
  const requestRef = React.useRef<AbortController | undefined>(undefined)
  const timeoutRef = React.useRef<number | undefined>(undefined)
  const previewUrl = recoveredPreviewUrl ?? userStory?.previewUrl
  const source = previewUrl ? previewSource(previewUrl) : undefined
  const previewKey = source ? `${source}-${reloadKey}` : ""
  const previewState =
    previewLoad.key === previewKey ? previewLoad.state : "loading"
  const previewLocation =
    previewLoad.key === previewKey ? previewLoad.location : undefined
  const locationBlocked =
    previewLoad.key === previewKey && previewLoad.locationBlocked
  const hasSetupLog = Boolean(userStory?.worktree)
  const [tab, setTab] = React.useState(source ? "preview" : "setup-log")
  const activeTab = activePreviewTab(tab, Boolean(source), hasSetupLog)

  const clearPreviewRequest = React.useCallback(() => {
    requestRef.current?.abort()
    requestRef.current = undefined
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
    timeoutRef.current = undefined
  }, [])

  const clearLocationInterval = React.useCallback(() => {
    if (!locationIntervalRef.current) return
    window.clearInterval(locationIntervalRef.current)
    locationIntervalRef.current = undefined
  }, [])

  const syncFrameLocation = React.useCallback(() => {
    const location = frameRef.current
      ? previewFrameLocation(frameRef.current, source)
      : undefined
    if (!location) {
      setPreviewLoad((current) =>
        current.key === previewKey && current.locationBlocked
          ? current
          : {
              key: previewKey,
              location:
                current.key === previewKey ? current.location : undefined,
              locationBlocked: true,
              state: "loaded",
            }
      )
      return
    }
    setPreviewLoad((current) =>
      current.key === previewKey &&
      current.location === location &&
      !current.locationBlocked
        ? current
        : { key: previewKey, location, state: "loaded" }
    )
  }, [previewKey, source])

  React.useEffect(() => {
    if (!source) return
    clearPreviewRequest()
    clearLocationInterval()
    const controller = new AbortController()
    requestRef.current = controller
    timeoutRef.current = window.setTimeout(
      () =>
        setPreviewLoad({ key: previewKey, location: source, state: "error" }),
      12000
    )
    void fetch(source, { mode: "no-cors", signal: controller.signal }).catch(
      () => {
        if (requestRef.current !== controller || controller.signal.aborted)
          return
        setPreviewLoad({ key: previewKey, location: source, state: "error" })
      }
    )
    return () => {
      clearLocationInterval()
      clearPreviewRequest()
    }
  }, [clearLocationInterval, clearPreviewRequest, previewKey, source])

  const reloadPreview = () => {
    setReloadKey((current) => current + 1)
    recoverPreview()
  }

  const recoverPreview = () => {
    if (!userStory?.worktree || !platform.workspace?.ensureProjectPreviewUrl)
      return
    void platform.workspace
      .ensureProjectPreviewUrl({ worktree: userStory.worktree })
      .then((previewUrl) => {
        if (previewUrl) setRecoveredPreviewUrl(previewUrl)
      })
      .catch(() => undefined)
  }

  const showPreview = () => {
    clearPreviewRequest()
    clearLocationInterval()
    setPreviewLoad({
      key: previewKey,
      location: source,
      state: "loaded",
    })
    syncFrameLocation()
    locationIntervalRef.current = window.setInterval(syncFrameLocation, 250)
  }

  const showPreviewError = () => {
    clearPreviewRequest()
    clearLocationInterval()
    setPreviewLoad({ key: previewKey, location: source, state: "error" })
  }

  const openPreview = () => {
    const target = source
    if (!target) return
    if (platform.openExternalLink) return platform.openExternalLink(target)
    window.open(target, "_blank", "noopener,noreferrer")
  }

  if (source || hasSetupLog) {
    return (
      <div className="h-full min-h-0 overflow-hidden">
        <Tabs
          value={activeTab}
          onValueChange={setTab}
          className="relative h-full min-h-0 gap-0 bg-muted/20"
        >
          <PreviewIsland
            hasPreview={Boolean(source)}
            hasSetupLog={hasSetupLog}
            locationBlocked={Boolean(locationBlocked)}
            onOpen={openPreview}
            onReload={reloadPreview}
            previewLocation={previewLocation}
            source={source}
          />
          {source && (
            <TabsContent
              value="preview"
              className="h-full min-h-0 overflow-hidden"
            >
              <PreviewPanel
                frameRef={frameRef}
                onError={showPreviewError}
                onLoad={showPreview}
                onReload={reloadPreview}
                previewKey={previewKey}
                previewState={previewState}
                source={source}
                title={`${userStory?.id ?? "user-story"} preview`}
              />
            </TabsContent>
          )}
          {hasSetupLog && (
            <TabsContent
              value="setup-log"
              className="h-full min-h-0 overflow-hidden"
            >
              <SetupLogPanel worktree={userStory?.worktree} />
            </TabsContent>
          )}
        </Tabs>
      </div>
    )
  }

  return (
    <div className="h-full min-h-0 p-6">
      <div className="flex h-full min-h-96 flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-muted/20 p-8 text-center">
        <MonitorIcon className="size-8 text-muted-foreground" />
        <div>
          <h3 className="font-heading text-lg font-semibold">Preview</h3>
          <p className="text-sm text-muted-foreground">
            Agent preview output will appear here.
          </p>
        </div>
      </div>
    </div>
  )
}

function PreviewPanel({
  frameRef,
  onError,
  onLoad,
  onReload,
  previewKey,
  previewState,
  source,
  title,
}: {
  frameRef: React.RefObject<HTMLIFrameElement | null>
  onError: () => void
  onLoad: () => void
  onReload: () => void
  previewKey: string
  previewState: PreviewState
  source: string
  title: string
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-muted/20 pt-[72px]">
      <div className="relative min-h-0 flex-1 bg-background">
        <iframe
          ref={frameRef}
          key={previewKey}
          className="h-full w-full border-0 bg-background"
          src={source}
          title={title}
          onError={onError}
          onLoad={onLoad}
        />
        {previewState === "loading" && <PreviewLoadingState />}
        {previewState === "error" && <PreviewErrorState onReload={onReload} />}
      </div>
    </div>
  )
}

function PreviewIsland({
  hasPreview,
  hasSetupLog,
  locationBlocked,
  onOpen,
  onReload,
  previewLocation,
  source,
}: {
  hasPreview: boolean
  hasSetupLog: boolean
  locationBlocked: boolean
  onOpen: () => void
  onReload: () => void
  previewLocation?: string
  source?: string
}) {
  return (
    <div className="pointer-events-none absolute inset-x-4 top-4 z-20 flex items-center gap-2">
      {source && (
        <PreviewAddress
          locationBlocked={locationBlocked}
          previewLocation={previewLocation}
          source={source}
        />
      )}
      {source && (
        <Button
          aria-label="Refresh preview"
          className="pointer-events-auto size-10 rounded-full border bg-background/95 shadow-sm backdrop-blur"
          size="icon"
          title="Refresh preview"
          type="button"
          variant="outline"
          onClick={onReload}
        >
          <RefreshCwIcon />
        </Button>
      )}
      {source && (
        <Button
          className="pointer-events-auto h-10 rounded-full border bg-background/95 px-4 shadow-sm backdrop-blur"
          size="sm"
          type="button"
          variant="outline"
          onClick={onOpen}
        >
          <ExternalLinkIcon />
          Open in browser
        </Button>
      )}
      <div className="min-w-2 flex-1" />
      <PreviewTabSelector hasPreview={hasPreview} hasSetupLog={hasSetupLog} />
    </div>
  )
}

function PreviewAddress({
  locationBlocked,
  previewLocation,
  source,
}: {
  locationBlocked: boolean
  previewLocation?: string
  source: string
}) {
  return (
    <div className="pointer-events-auto flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full border bg-background/95 px-4 shadow-sm backdrop-blur">
      <MonitorIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate text-sm text-muted-foreground">
        {previewLocation ?? source}
      </span>
      {locationBlocked && <BlockedLocationBadge />}
    </div>
  )
}

function PreviewTabSelector({
  hasPreview,
  hasSetupLog,
}: {
  hasPreview: boolean
  hasSetupLog: boolean
}) {
  return (
    <TabsList className="pointer-events-auto h-10 shrink-0 rounded-full border bg-background/95 p-1 shadow-sm backdrop-blur">
      {hasPreview && (
        <TabsTrigger className="rounded-full px-3" value="preview">
          <MonitorIcon />
          Preview
        </TabsTrigger>
      )}
      {hasSetupLog && (
        <TabsTrigger className="rounded-full px-3" value="setup-log">
          <PlayIcon />
          Run logs
        </TabsTrigger>
      )}
    </TabsList>
  )
}

function BlockedLocationBadge() {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs text-muted-foreground"
      title="Le navigateur bloque l'URL interne de cette preview."
    >
      <LockIcon className="size-3" />
      URL interne masquée
    </span>
  )
}

function SetupLogPanel({ worktree }: { worktree?: string | null }) {
  const { content, error, loading } = useSetupLog(worktree)
  const logRef = React.useRef<HTMLPreElement>(null)

  React.useEffect(() => {
    const element = logRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [content])

  return (
    <div className="grid h-full min-h-0 overflow-hidden bg-zinc-950 pt-[72px]">
      <pre
        ref={logRef}
        className="min-h-0 overflow-auto p-4 font-mono text-xs whitespace-pre-wrap text-zinc-100"
      >
        {setupLogContent(content, error, loading)}
      </pre>
    </div>
  )
}

function useSetupLog(worktree?: string | null) {
  const platform = usePlatform()
  const [state, setState] = React.useState({
    content: "",
    loading: Boolean(worktree),
    error: "",
    worktree,
  })

  React.useEffect(() => {
    if (!worktree || !platform.workspace) return
    let cancelled = false
    const readLog = () => {
      platform.workspace
        ?.readFile({ root: worktree, path: ".blame/logs/setup.log" })
        .then((content) => {
          if (!cancelled)
            setState({ content, error: "", loading: false, worktree })
        })
        .catch((error) => {
          if (!cancelled) setState(logErrorState(error, worktree))
        })
    }
    readLog()
    const interval = window.setInterval(readLog, 1000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [platform.workspace, worktree])

  if (!worktree) return { content: "", error: "", loading: false, worktree }
  if (!platform.workspace) {
    return {
      content: "",
      error: "Desktop workspace bridge is unavailable.",
      loading: false,
      worktree,
    }
  }
  if (state.worktree !== worktree) {
    return { content: "", error: "", loading: true, worktree }
  }

  return state
}

function logErrorState(error: unknown, worktree?: string | null) {
  return {
    content: "",
    error: error instanceof Error ? error.message : "Unable to read setup logs",
    loading: false,
    worktree,
  }
}

function setupLogContent(content: string, error: string, loading: boolean) {
  if (content) return content
  if (loading) return "Loading setup logs..."
  if (error) return error
  return "No setup logs yet."
}

function activePreviewTab(
  tab: string,
  hasPreview: boolean,
  hasSetupLog: boolean
) {
  if (tab === "preview" && hasPreview) return tab
  if (tab === "setup-log" && hasSetupLog) return tab
  if (hasPreview) return "preview"
  return "setup-log"
}

function PreviewLoadingState() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background/95">
      <div className="flex flex-col items-center gap-4 rounded-lg border bg-background px-8 py-7 text-center shadow-sm">
        <LoaderCircleIcon className="size-8 animate-spin text-primary" />
        <div className="space-y-1">
          <h3 className="font-heading text-lg font-semibold">
            Chargement de la preview
          </h3>
          <p className="text-sm text-muted-foreground">
            Connexion au serveur de preview en cours.
          </p>
        </div>
      </div>
    </div>
  )
}

function PreviewErrorState({ onReload }: { onReload: () => void }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background/95 p-8">
      <div className="flex max-w-sm flex-col items-center gap-4 rounded-lg border bg-background px-8 py-7 text-center shadow-sm">
        <div className="rounded-full bg-destructive/10 p-3 text-destructive">
          <AlertTriangleIcon className="size-6" />
        </div>
        <div className="space-y-1">
          <h3 className="font-heading text-lg font-semibold">
            Preview indisponible
          </h3>
          <p className="text-sm text-muted-foreground">
            Le serveur ne répond pas pour le moment.
          </p>
        </div>
        <Button size="sm" type="button" variant="outline" onClick={onReload}>
          <RefreshCwIcon />
          Réessayer
        </Button>
      </div>
    </div>
  )
}

function previewSource(previewUrl: string) {
  if (/^https?:\/\//.test(previewUrl)) return previewUrl
  return `http://${previewUrl}`
}

function previewFrameLocation(frame: HTMLIFrameElement, source?: string) {
  try {
    const location = frame.contentWindow?.location.href
    if (!location || !source) return location
    return new URL(location).origin === new URL(source).origin
      ? location
      : undefined
  } catch {
    return undefined
  }
}
