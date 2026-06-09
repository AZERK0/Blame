import * as React from "react"
import {
  AlertTriangleIcon,
  FocusIcon,
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
import { type PreviewBrowserClient, usePlatform } from "@/context/platform"
import { cn } from "@/lib/utils"

type PreviewState = "loading" | "loaded" | "error"
type PreviewLoad = {
  key: string
  location?: string
  locationBlocked?: boolean
  state: PreviewState
}
type PreviewAmbilightColor = {
  blue: number
  green: number
  red: number
}
type NativePreviewState = {
  error?: string
  key: string
  loading: boolean
  url?: string
}
type NativePreviewStateInput = {
  error?: string
  loading: boolean
  url?: string
}
type PreviewPanelProps = {
  frameRef: React.RefObject<HTMLIFrameElement | null>
  onError: () => void
  onLoad: () => void
  onReload: () => void
  previewKey: string
  previewState: PreviewState
  source: string
  title: string
}
type NativePreviewPanelProps = {
  client: PreviewBrowserClient
  onCaptureReady: (capture?: PreviewCaptureHandler) => void
  onState: (state: NativePreviewStateInput) => void
  previewKey: string
  previewState: PreviewState
  reloadKey: number
  source: string
  visible: boolean
}
type PreviewIslandProps = {
  activeTab: string
  captureDisabled?: boolean
  hasPreview: boolean
  hasSetupLog: boolean
  locationBlocked: boolean
  onCapture?: () => void
  onNavigatePath: (path: string) => void
  onOpen: () => void
  onReload: () => void
  previewLocation?: string
  source?: string
}
type PreviewCaptureHandler = () => Promise<File | undefined>
type NativePreviewFrameProps = {
  ambilightColor?: PreviewAmbilightColor
  browserId?: string
  client: PreviewBrowserClient
  previewState: PreviewState
  surfaceRef: React.RefObject<HTMLDivElement | null>
}
type NativePreviewBoundsStability = {
  boundsKey: string
  stableFrames: number
}

const nativePreviewStableFrames = 3

export function UserStoryPreview({
  onCapture,
  setupInitializing,
  userStory,
}: {
  onCapture?: (file: File) => void
  setupInitializing?: boolean
  userStory?: UserStory
}) {
  const platform = usePlatform()
  const previewBrowser = platform.previewBrowser
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
  const baseSource = previewUrl ? previewSource(previewUrl) : undefined
  const [editedPreview, setEditedPreview] = React.useState<{
    baseSource?: string
    url: string
  }>()
  const source =
    editedPreview && editedPreview.baseSource === baseSource
      ? editedPreview.url
      : baseSource
  const previewKey = source ? `${source}-${reloadKey}` : ""
  const nativePreviewKey = source ?? ""
  const setupPreviewReady = useSetupPreviewReady(
    source,
    reloadKey,
    Boolean(setupInitializing && source)
  )
  const setupPreviewWaiting = Boolean(
    setupInitializing && source && !setupPreviewReady
  )
  const previewState =
    previewLoad.key === previewKey ? previewLoad.state : "loading"
  const previewLocation =
    previewLoad.key === previewKey ? previewLoad.location : undefined
  const locationBlocked =
    previewLoad.key === previewKey && previewLoad.locationBlocked
  const hasSetupLog = Boolean(userStory?.worktree)
  const services = useProjectServices(userStory?.worktree)
  const [selectedLogService, setSelectedLogService] = React.useState("")
  const [tab, setTab] = React.useState(source ? "preview" : "setup-log")
  const autoSelectedPreviewSourceRef = React.useRef<string | undefined>(
    undefined
  )
  const activeTab = activePreviewTab(tab, Boolean(source), hasSetupLog)
  const [nativePreviewState, setNativePreviewState] =
    React.useState<NativePreviewState>()
  const [previewCapture, setPreviewCapture] =
    React.useState<PreviewCaptureHandler>()
  const activeNativePreviewState =
    nativePreviewState?.key === nativePreviewKey
      ? nativePreviewState
      : undefined

  React.useEffect(() => {
    if (services.length === 0) {
      setSelectedLogService("")
      return
    }
    setSelectedLogService((current) =>
      services.includes(current) ? current : services[0]
    )
  }, [services])
  const hasNativePreview = Boolean(
    previewBrowser && source && !setupPreviewWaiting
  )
  const displayedPreviewState = hasNativePreview
    ? nativePreviewStatus(activeNativePreviewState)
    : setupPreviewWaiting
      ? "loading"
      : previewState
  const displayedPreviewLocation = hasNativePreview
    ? activeNativePreviewState?.url
    : previewLocation
  const displayedLocationBlocked = hasNativePreview
    ? false
    : Boolean(locationBlocked)

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
    if (!source || previewBrowser) return
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
  }, [
    clearLocationInterval,
    clearPreviewRequest,
    previewBrowser,
    previewKey,
    source,
  ])

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
    const target = displayedPreviewLocation ?? source
    if (!target) return
    if (platform.openExternalLink) return platform.openExternalLink(target)
    window.open(target, "_blank", "noopener,noreferrer")
  }
  const navigatePreviewPath = React.useCallback(
    (path: string) => {
      if (!source) return
      setEditedPreview({
        baseSource,
        url: previewPathUrl(source, path),
      })
    },
    [baseSource, source]
  )
  const handleNativePreviewState = React.useCallback(
    (state: { error?: string; loading: boolean; url?: string }) =>
      setNativePreviewState({ ...state, key: nativePreviewKey }),
    [nativePreviewKey]
  )
  const capturePreview = React.useCallback(() => {
    if (!previewCapture) return
    void previewCapture().then((file) => {
      if (file) onCapture?.(file)
    })
  }, [onCapture, previewCapture])
  const setPreviewCaptureHandler = React.useCallback(
    (capture?: PreviewCaptureHandler) => setPreviewCapture(() => capture),
    []
  )

  React.useEffect(() => {
    if (!source || setupPreviewWaiting) return
    if (autoSelectedPreviewSourceRef.current === source) return
    autoSelectedPreviewSourceRef.current = source
    setTab("preview")
  }, [setupPreviewWaiting, source])

  if (source || hasSetupLog) {
    return (
      <div className="h-full min-h-0 overflow-hidden">
        <Tabs
          value={activeTab}
          onValueChange={setTab}
          className="relative h-full min-h-0 gap-0 bg-muted/20"
        >
          <PreviewIsland
            activeTab={activeTab}
            captureDisabled={setupPreviewWaiting || !previewCapture}
            hasPreview={Boolean(source)}
            hasSetupLog={hasSetupLog}
            locationBlocked={displayedLocationBlocked}
            onCapture={capturePreview}
            onNavigatePath={navigatePreviewPath}
            onOpen={openPreview}
            onReload={reloadPreview}
            previewLocation={displayedPreviewLocation}
            source={source}
          />
          {source && (
            <TabsContent
              value="preview"
              className="h-full min-h-0 overflow-hidden"
            >
              {setupPreviewWaiting ? (
                <PreviewWaitingPanel />
              ) : previewBrowser ? (
                <NativePreviewPanel
                  client={previewBrowser}
                  onCaptureReady={setPreviewCaptureHandler}
                  onState={handleNativePreviewState}
                  previewKey={nativePreviewKey}
                  previewState={displayedPreviewState}
                  reloadKey={reloadKey}
                  source={source}
                  visible={activeTab === "preview"}
                />
              ) : (
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
              )}
            </TabsContent>
          )}
          {hasSetupLog && (
            <TabsContent
              value="setup-log"
              className="h-full min-h-0 overflow-hidden"
            >
              <SetupLogPanel
                onSelectService={setSelectedLogService}
                service={selectedLogService}
                services={services}
                worktree={userStory?.worktree}
              />
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
}: PreviewPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-muted/20 px-4 pt-[72px] pb-4">
      <div
        className="relative min-h-0 flex-1 overflow-hidden rounded-lg border bg-background transition-shadow duration-700"
        style={{ boxShadow: previewAmbilightShadow(undefined) }}
      >
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

function PreviewWaitingPanel() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-muted/20 px-4 pt-[72px] pb-4">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border bg-background">
        <PreviewLoadingState />
      </div>
    </div>
  )
}

function NativePreviewPanel({
  client,
  onCaptureReady,
  onState,
  previewKey,
  previewState,
  reloadKey,
  source,
  visible,
}: NativePreviewPanelProps) {
  const surfaceRef = React.useRef<HTMLDivElement>(null)
  const browserId = useNativePreviewId(client)
  const ambilightColor = useNativePreviewAmbilightColor(
    client,
    browserId,
    previewKey,
    visible && previewState === "loaded"
  )

  React.useEffect(() => {
    if (!browserId) return
    return client.onState({ id: browserId }, onState)
  }, [browserId, client, onState])

  useNativePreviewLoad(client, browserId, source, onState)
  useNativePreviewReload(client, browserId, reloadKey, source, onState)
  useNativePreviewCapture(client, browserId, source, onCaptureReady)
  useNativePreviewBounds(
    client,
    browserId,
    surfaceRef,
    visible && previewState === "loaded"
  )

  return (
    <NativePreviewFrame
      ambilightColor={ambilightColor}
      browserId={browserId}
      client={client}
      previewState={previewState}
      surfaceRef={surfaceRef}
    />
  )
}

function useNativePreviewCapture(
  client: PreviewBrowserClient,
  browserId: string | undefined,
  source: string,
  onCaptureReady: (capture?: PreviewCaptureHandler) => void
) {
  React.useEffect(() => {
    if (!browserId) {
      onCaptureReady(undefined)
      return
    }
    onCaptureReady(() => captureNativePreview(client, browserId, source))
    return () => onCaptureReady(undefined)
  }, [browserId, client, onCaptureReady, source])
}

function NativePreviewFrame({
  ambilightColor,
  browserId,
  client,
  previewState,
  surfaceRef,
}: NativePreviewFrameProps) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-muted/20 px-4 pt-[72px] pb-4">
      <div
        className="relative min-h-0 flex-1 overflow-hidden rounded-lg border bg-background transition-shadow duration-700"
        style={{ boxShadow: previewAmbilightShadow(ambilightColor) }}
      >
        <div ref={surfaceRef} className="h-full w-full" />
        {previewState === "loading" && <PreviewLoadingState />}
        {previewState === "error" && (
          <PreviewErrorState
            onReload={() => reloadNativePreview(client, browserId)}
          />
        )}
      </div>
    </div>
  )
}

function useNativePreviewId(client: PreviewBrowserClient) {
  const [browserId, setBrowserId] = React.useState<string>()

  React.useEffect(() => {
    let cancelled = false
    let createdId: string | undefined
    void client.create().then(({ id }) => {
      createdId = id
      if (cancelled) {
        void client.destroy({ id })
        return
      }
      setBrowserId(id)
    })
    return () => {
      cancelled = true
      if (createdId) void client.destroy({ id: createdId })
    }
  }, [client])

  return browserId
}

function reloadNativePreview(
  client: PreviewBrowserClient,
  browserId: string | undefined
) {
  if (browserId) void client.reload({ id: browserId })
}

function useNativePreviewLoad(
  client: PreviewBrowserClient,
  browserId: string | undefined,
  source: string,
  onState: (state: NativePreviewStateInput) => void
) {
  React.useEffect(() => {
    if (!browserId) return
    onState({ loading: true, url: source })
    void client.load({ id: browserId, url: source }).catch((error) => {
      onState(nativePreviewErrorState(error, "Unable to load preview", source))
    })
  }, [browserId, client, onState, source])
}

function useSetupPreviewReady(
  source: string | undefined,
  reloadKey: number,
  enabled: boolean
) {
  const [state, setState] = React.useState({
    ready: true,
    reloadKey: 0,
    source: "",
  })

  React.useEffect(() => {
    if (!enabled || !source) {
      return
    }
    let cancelled = false
    const check = async () => {
      const ready = await previewResponds(source)
      if (!cancelled) {
        setState({
          ready,
          reloadKey,
          source,
        })
      }
    }
    void check()
    const interval = window.setInterval(() => void check(), 2000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [enabled, reloadKey, source])

  if (!enabled || !source) return true
  if (state.source !== source || state.reloadKey !== reloadKey) return false
  return state.ready
}

async function previewResponds(source: string) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 2500)
  try {
    await fetch(source, {
      cache: "no-store",
      mode: "no-cors",
      signal: controller.signal,
    })
    return true
  } catch {
    return false
  } finally {
    window.clearTimeout(timeout)
  }
}

function useNativePreviewReload(
  client: PreviewBrowserClient,
  browserId: string | undefined,
  reloadKey: number,
  source: string,
  onState: (state: NativePreviewStateInput) => void
) {
  const reloadKeyRef = React.useRef(reloadKey)

  React.useEffect(() => {
    if (!browserId || reloadKeyRef.current === reloadKey) return
    reloadKeyRef.current = reloadKey
    onState({ loading: true, url: source })
    void client.reload({ id: browserId }).catch((error) => {
      onState(
        nativePreviewErrorState(error, "Unable to reload preview", source)
      )
    })
  }, [browserId, client, onState, reloadKey, source])
}

function useNativePreviewBounds(
  client: PreviewBrowserClient,
  browserId: string | undefined,
  surfaceRef: React.RefObject<HTMLDivElement | null>,
  visible: boolean
) {
  const lastBoundsRef = React.useRef<string>("")
  const stabilityRef = React.useRef<NativePreviewBoundsStability>({
    boundsKey: "",
    stableFrames: 0,
  })

  React.useEffect(() => {
    if (!browserId) return
    const updateBounds = () =>
      syncNativePreviewBounds(
        client,
        browserId,
        surfaceRef,
        visible,
        lastBoundsRef,
        stabilityRef
      )
    updateBounds()
    const stopFrameSync = syncNativePreviewBoundsOnFrames(updateBounds, visible)
    const observer = new ResizeObserver(updateBounds)
    if (surfaceRef.current) observer.observe(surfaceRef.current)
    window.addEventListener("resize", updateBounds)
    window.addEventListener("scroll", updateBounds, true)
    return () => {
      stopFrameSync()
      observer.disconnect()
      window.removeEventListener("resize", updateBounds)
      window.removeEventListener("scroll", updateBounds, true)
      void client.setBounds({
        bounds: { height: 0, width: 0, x: 0, y: 0 },
        id: browserId,
        visible: false,
      })
      stabilityRef.current = { boundsKey: "", stableFrames: 0 }
    }
  }, [browserId, client, surfaceRef, visible])
}

function syncNativePreviewBoundsOnFrames(
  updateBounds: () => void,
  enabled: boolean
) {
  if (!enabled) return () => undefined
  let frame = 0
  const updateFrame = () => {
    updateBounds()
    frame = window.requestAnimationFrame(updateFrame)
  }
  frame = window.requestAnimationFrame(updateFrame)
  return () => window.cancelAnimationFrame(frame)
}

function syncNativePreviewBounds(
  client: PreviewBrowserClient,
  browserId: string,
  surfaceRef: React.RefObject<HTMLDivElement | null>,
  visible: boolean,
  lastBoundsRef: React.MutableRefObject<string>,
  stabilityRef: React.MutableRefObject<NativePreviewBoundsStability>
) {
  const bounds = nativePreviewSurfaceBounds(surfaceRef.current)
  const boundsKey = `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`
  if (!visible) stabilityRef.current = { boundsKey: "", stableFrames: 0 }
  const shouldShow =
    visible &&
    bounds.height > 0 &&
    bounds.width > 0 &&
    stableNativePreviewBounds(boundsKey, stabilityRef)
  const key = `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}:${shouldShow}`
  if (lastBoundsRef.current === key) return
  lastBoundsRef.current = key
  void client.setBounds({ bounds, id: browserId, visible: shouldShow })
}

function stableNativePreviewBounds(
  boundsKey: string,
  stabilityRef: React.MutableRefObject<NativePreviewBoundsStability>
) {
  const current = stabilityRef.current
  if (current.boundsKey !== boundsKey) {
    stabilityRef.current = { boundsKey, stableFrames: 0 }
    return false
  }
  const stableFrames = current.stableFrames + 1
  stabilityRef.current = { boundsKey, stableFrames }
  return stableFrames >= nativePreviewStableFrames
}

function useNativePreviewAmbilightColor(
  client: PreviewBrowserClient,
  browserId: string | undefined,
  previewKey: string,
  visible: boolean
) {
  const [sample, setSample] = React.useState<{
    color?: PreviewAmbilightColor
    key: string
  }>()

  React.useEffect(() => {
    if (!browserId || !visible) return
    let cancelled = false
    const sampleFrame = async () => {
      const color = await captureNativePreviewAmbilight(client, browserId)
      if (cancelled) return
      setSample((current) =>
        current?.key === previewKey && sameAmbilightColor(current.color, color)
          ? current
          : { color, key: previewKey }
      )
    }
    const timeout = window.setTimeout(sampleFrame, 300)
    const interval = window.setInterval(sampleFrame, 1800)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
      window.clearInterval(interval)
    }
  }, [browserId, client, previewKey, visible])

  return sample?.key === previewKey ? sample.color : undefined
}

async function captureNativePreviewAmbilight(
  client: PreviewBrowserClient,
  browserId: string
) {
  try {
    const image = await client.capture({ id: browserId, size: "thumbnail" })
    return image ? await readImageAmbilightColor(image) : undefined
  } catch {
    return undefined
  }
}

async function captureNativePreview(
  client: PreviewBrowserClient,
  browserId: string,
  source: string
) {
  const image = await client.capture({ id: browserId, size: "full" })
  if (!image) return undefined
  return dataUrlFile(image, previewCaptureFilename(source))
}

function PreviewIsland({
  activeTab,
  captureDisabled,
  hasPreview,
  hasSetupLog,
  locationBlocked,
  onCapture,
  onNavigatePath,
  onOpen,
  onReload,
  previewLocation,
  source,
}: PreviewIslandProps) {
  const showingLogs = activeTab === "setup-log"

  return (
    <div className="pointer-events-none absolute inset-x-4 top-4 z-20 flex items-center gap-1.5">
      {!showingLogs && source ? (
        <PreviewAddress
          locationBlocked={locationBlocked}
          onNavigatePath={onNavigatePath}
          onOpen={onOpen}
          previewLocation={previewLocation}
          source={source}
        />
      ) : (
        <div className="min-w-2 flex-1" />
      )}
      {!showingLogs && source && (
        <PreviewActions
          captureDisabled={captureDisabled}
          onCapture={onCapture}
          onReload={onReload}
        />
      )}
      <div className="min-w-2 flex-1" />
      <PreviewTabSelector hasPreview={hasPreview} hasSetupLog={hasSetupLog} />
    </div>
  )
}

function ServiceLogTabs({
  selectedService,
  services,
  onSelectService,
}: {
  selectedService?: string
  services: string[]
  onSelectService: (service: string) => void
}) {
  return (
    <div
      className="flex h-10 w-full flex-none items-end overflow-hidden pr-4 pt-1"
      role="tablist"
    >
      <div className="flex w-fit max-w-full [scrollbar-width:none] items-end gap-1 overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:hidden">
        {services.map((service, index) => {
          const isSelected = selectedService === service
          const isFirst = index === 0
          const isLast = index === services.length - 1

          return (
            <button
              key={service}
              aria-selected={isSelected}
              role="tab"
              className={cn(
                [
                  "relative h-9 shrink-0 rounded-t-xl border border-transparent bg-transparent px-7 text-sm whitespace-nowrap text-muted-foreground capitalize",
                  "transition-[color,background-color,border-color] duration-150 hover:text-foreground",

                  "[--corner-bg:transparent] [--tab-bg:#09090b]",

                  "before:pointer-events-none before:absolute before:bottom-0 before:-left-4 before:h-4 before:w-4 before:content-['']",
                  "before:rounded-br-xl before:shadow-[4px_4px_0_4px_var(--corner-bg)]",
                  "before:transition-shadow before:duration-150",

                  "after:pointer-events-none after:absolute after:-right-4 after:bottom-0 after:h-4 after:w-4 after:content-['']",
                  "after:rounded-bl-xl after:shadow-[-4px_4px_0_4px_var(--corner-bg)]",
                  "after:transition-shadow after:duration-150",
                ],
                isSelected && [
                  "z-10 -mb-px bg-[var(--tab-bg)] text-foreground",
                  "[--corner-bg:var(--tab-bg)]",
                ],
                isSelected && isFirst && "before:hidden",
                isSelected && isLast && "after:hidden"
              )}
              type="button"
              onClick={() => onSelectService(service)}
            >
              {service}
            </button>
          )
        })}

        {services.length === 0 && (
          <span className="px-4 pb-2 text-sm text-muted-foreground">
            Loading services
          </span>
        )}
      </div>
    </div>
  )
}

function PreviewActions({
  captureDisabled,
  onCapture,
  onReload,
}: {
  captureDisabled?: boolean
  onCapture?: () => void
  onReload: () => void
}) {
  return (
    <>
      <Button
        aria-label="Refresh preview"
        className="pointer-events-auto size-9 rounded-full border bg-background/95 shadow-sm backdrop-blur"
        size="icon"
        title="Refresh preview"
        type="button"
        variant="outline"
        onClick={onReload}
      >
        <RefreshCwIcon />
      </Button>
      <Button
        aria-label="Capture preview"
        className="pointer-events-auto size-9 rounded-full border bg-background/95 shadow-sm backdrop-blur"
        disabled={captureDisabled}
        size="icon"
        title="Capture preview"
        type="button"
        variant="outline"
        onClick={onCapture}
      >
        <FocusIcon />
      </Button>
    </>
  )
}

function PreviewAddress({
  locationBlocked,
  onNavigatePath,
  onOpen,
  previewLocation,
  source,
}: {
  locationBlocked: boolean
  onNavigatePath: (path: string) => void
  onOpen: () => void
  previewLocation?: string
  source: string
}) {
  const address = previewLocation ?? source
  const origin = previewAddressOrigin(source)
  const path = previewAddressPath(address)
  const [draft, setDraft] = React.useState({ path, value: path })
  const draftPath = draft.path === path ? draft.value : path

  const commitPath = () => {
    const nextPath = normalizePreviewPath(draftPath)
    setDraft({ path, value: nextPath })
    if (nextPath !== path) onNavigatePath(nextPath)
  }

  return (
    <div className="pointer-events-auto flex h-10 min-w-0 flex-1 items-center rounded-full border bg-background/95 py-1 pr-1.5 pl-4 shadow-sm backdrop-blur">
      <span className="shrink-0 text-sm text-muted-foreground/70">
        {origin}
      </span>
      <input
        aria-label="Preview path"
        className="min-w-0 flex-1 bg-transparent text-sm text-muted-foreground outline-none"
        spellCheck={false}
        value={draftPath}
        onBlur={commitPath}
        onChange={(event) =>
          setDraft({ path, value: event.currentTarget.value })
        }
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur()
          if (event.key === "Escape") {
            setDraft({ path, value: path })
            event.currentTarget.blur()
          }
        }}
      />
      {locationBlocked && <BlockedLocationBadge />}
      <Button
        aria-label="Open preview in browser"
        className="ml-2 size-7 rounded-full"
        size="icon"
        title="Open preview in browser"
        type="button"
        variant="ghost"
        onClick={onOpen}
      >
        <ExternalLinkIcon />
      </Button>
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

function SetupLogPanel({
  onSelectService,
  service,
  services,
  worktree,
}: {
  onSelectService: (service: string) => void
  service: string
  services: string[]
  worktree?: string | null
}) {
  const { content, error, loading } = useProjectServiceLog(worktree, service)
  const logRef = React.useRef<HTMLPreElement>(null)
  const firstServiceSelected = services[0] === service

  React.useEffect(() => {
    const element = logRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [content])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-muted/20 px-4 pt-4 pb-4">
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <ServiceLogTabs
          selectedService={service}
          services={services}
          onSelectService={onSelectService}
        />
        <pre
          ref={logRef}
          className={cn(
            "min-h-0 flex-1 overflow-auto rounded-lg bg-zinc-950 p-4 font-mono text-xs whitespace-pre-wrap text-zinc-100",
            "[scrollbar-color:color-mix(in_oklab,var(--muted-foreground)_35%,transparent)_transparent] [scrollbar-width:thin]",
            "[&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar]:w-2.5",
            "[&::-webkit-scrollbar-corner]:bg-background",
            "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border",
            "[&::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/45",
            "[&::-webkit-scrollbar-track]:bg-transparent",
            firstServiceSelected && "rounded-tl-none"
          )}
        >
          {serviceLogContent(content, error, loading, services.length)}
        </pre>
      </div>
    </div>
  )
}

function useProjectServices(worktree?: string | null) {
  const platform = usePlatform()
  const [services, setServices] = React.useState<string[]>([])

  React.useEffect(() => {
    if (!worktree || !platform.workspace?.listProjectServices) {
      setServices([])
      return
    }
    let cancelled = false
    const loadServices = () => {
      platform.workspace
        ?.listProjectServices?.({ worktree })
        .then((nextServices) => {
          if (!cancelled) setServices(nextServices)
        })
        .catch(() => {
          if (!cancelled) setServices([])
        })
    }
    loadServices()
    const interval = window.setInterval(loadServices, 2000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [platform.workspace, worktree])

  return services
}

function useProjectServiceLog(worktree?: string | null, service?: string) {
  const platform = usePlatform()
  const [state, setState] = React.useState({
    content: "",
    error: "",
    loading: Boolean(worktree && service),
    service,
    worktree,
  })

  React.useEffect(() => {
    if (!worktree || !service || !platform.workspace) return
    if (
      !platform.workspace.startProjectServiceLogs ||
      !platform.workspace.stopProjectServiceLogs ||
      !platform.workspace.onProjectServiceLog
    ) {
      setState({
        content: "",
        error: "Desktop workspace bridge is unavailable.",
        loading: false,
        service,
        worktree,
      })
      return
    }
    let cancelled = false
    let cleanup = () => {}
    let activeStreamId = ""
    setState({ content: "", error: "", loading: true, service, worktree })
    void platform.workspace
      .startProjectServiceLogs({ service, worktree })
      .then(({ streamId }) => {
        activeStreamId = streamId
        if (cancelled) {
          void platform.workspace?.stopProjectServiceLogs?.({ streamId })
          return
        }
        setState((current) => ({ ...current, loading: false }))
        cleanup = platform.workspace?.onProjectServiceLog?.(
          streamId,
          (event) => {
            if (event.type === "exit") return
            setState((current) => ({
              ...current,
              content: `${current.content}${event.data}`,
              error: "",
              loading: false,
            }))
          }
        ) ?? (() => {})
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            content: "",
            error:
              error instanceof Error
                ? error.message
                : "Unable to read service logs",
            loading: false,
            service,
            worktree,
          })
        }
      })
    return () => {
      cancelled = true
      cleanup()
      if (activeStreamId) {
        void platform.workspace?.stopProjectServiceLogs?.({
          streamId: activeStreamId,
        })
      }
    }
  }, [platform.workspace, service, worktree])

  if (!worktree || !service) {
    return { content: "", error: "", loading: false, service, worktree }
  }
  if (state.worktree !== worktree || state.service !== service) {
    return { content: "", error: "", loading: true, service, worktree }
  }
  return state
}

function serviceLogContent(
  content: string,
  error: string,
  loading: boolean,
  serviceCount: number
) {
  if (content) return content
  if (loading) return "Loading service logs..."
  if (error) return error
  if (serviceCount === 0) return "No services found yet."
  return "No service logs yet."
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

function nativePreviewStatus(state: NativePreviewState | undefined) {
  if (!state || state.loading) return "loading"
  if (state.error) return "error"
  return "loaded"
}

function nativePreviewErrorState(
  error: unknown,
  fallback: string,
  url: string
): NativePreviewStateInput {
  return {
    error: error instanceof Error ? error.message : fallback,
    loading: false,
    url,
  }
}

function PreviewLoadingState() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background">
      <LoaderCircleIcon className="size-10 animate-spin text-muted-foreground" />
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

function averageAmbilightColor(colors: PreviewAmbilightColor[]) {
  if (!colors.length) return undefined
  const total = colors.reduce(
    (result, color) => {
      const weight = ambilightColorWeight(color)
      return {
        blue: result.blue + color.blue * weight,
        green: result.green + color.green * weight,
        red: result.red + color.red * weight,
        weight: result.weight + weight,
      }
    },
    { blue: 0, green: 0, red: 0, weight: 0 }
  )
  if (!total.weight) return undefined
  return {
    blue: Math.round(total.blue / total.weight),
    green: Math.round(total.green / total.weight),
    red: Math.round(total.red / total.weight),
  }
}

function isUsefulAmbilightColor(color: PreviewAmbilightColor) {
  const luminance =
    (0.2126 * color.red + 0.7152 * color.green + 0.0722 * color.blue) / 255
  return (
    luminance > 0.05 && luminance < 0.96 && ambilightSaturation(color) > 0.04
  )
}

function ambilightColorWeight(color: PreviewAmbilightColor) {
  return 0.4 + ambilightSaturation(color) * 2
}

function ambilightSaturation(color: PreviewAmbilightColor) {
  const red = color.red / 255
  const green = color.green / 255
  const blue = color.blue / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  if (!max) return 0
  return (max - min) / max
}

function clampColorValue(value: number) {
  if (Number.isNaN(value)) return 0
  return Math.max(0, Math.min(255, Math.round(value)))
}

function readImageAmbilightColor(dataUrl: string) {
  return new Promise<PreviewAmbilightColor | undefined>((resolve) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement("canvas")
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext("2d")
      if (!context) {
        resolve(undefined)
        return
      }
      context.drawImage(image, 0, 0)
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data
      resolve(averageAmbilightColor(readImageAmbilightPixels(data)))
    }
    image.onerror = () => resolve(undefined)
    image.src = dataUrl
  })
}

function readImageAmbilightPixels(data: Uint8ClampedArray) {
  const colors: PreviewAmbilightColor[] = []
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < 60) continue
    const color = {
      blue: clampColorValue(data[index + 2]),
      green: clampColorValue(data[index + 1]),
      red: clampColorValue(data[index]),
    }
    if (isUsefulAmbilightColor(color)) colors.push(color)
  }
  return colors
}

function dataUrlFile(dataUrl: string, filename: string) {
  const [header, data] = dataUrl.split(",")
  const type = header?.match(/^data:([^;]+)/)?.[1] ?? "image/png"
  const bytes = Uint8Array.from(atob(data ?? ""), (character) =>
    character.charCodeAt(0)
  )
  return new File([bytes], filename, { type })
}

function previewCaptureFilename(source: string) {
  return `preview-${previewCaptureHost(source)}-${previewCaptureTimestamp()}.png`
}

function previewCaptureHost(source: string) {
  try {
    return new URL(source).host.replaceAll(/[^a-z0-9.-]/gi, "-")
  } catch {
    return "capture"
  }
}

function previewCaptureTimestamp() {
  return new Date().toISOString().replaceAll(/[:.]/g, "-")
}

function previewBrowserBounds(rect: DOMRect) {
  return {
    height: rect.height,
    width: rect.width,
    x: rect.x,
    y: rect.y,
  }
}

function nativePreviewSurfaceBounds(element: HTMLDivElement | null) {
  return element
    ? previewBrowserBounds(element.getBoundingClientRect())
    : { height: 0, width: 0, x: 0, y: 0 }
}

function sameAmbilightColor(
  current: PreviewAmbilightColor | undefined,
  next: PreviewAmbilightColor | undefined
) {
  if (!current || !next) return current === next
  return (
    current.red === next.red &&
    current.green === next.green &&
    current.blue === next.blue
  )
}

function previewAmbilightShadow(color: PreviewAmbilightColor | undefined) {
  if (!color) return "0 24px 80px rgb(0 0 0 / 0.34)"
  return [
    `0 32px 120px rgb(${color.red} ${color.green} ${color.blue} / 0.58)`,
    `0 0 70px rgb(${color.red} ${color.green} ${color.blue} / 0.42)`,
    `0 0 28px rgb(${color.red} ${color.green} ${color.blue} / 0.5)`,
    "0 16px 44px rgb(0 0 0 / 0.28)",
  ].join(", ")
}

function previewSource(previewUrl: string) {
  if (/^https?:\/\//.test(previewUrl)) return previewUrl
  return `http://${previewUrl}`
}

function previewPathUrl(source: string, path: string) {
  const url = new URL(source)
  const next = new URL(normalizePreviewPath(path), url.origin)
  return next.toString()
}

function previewAddressOrigin(source: string) {
  try {
    return new URL(source).origin
  } catch {
    return source
  }
}

function previewAddressPath(source: string) {
  try {
    const url = new URL(source)
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return "/"
  }
}

function normalizePreviewPath(path: string) {
  const trimmed = path.trim()
  if (!trimmed) return "/"
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`
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
