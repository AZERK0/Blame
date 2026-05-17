import * as React from "react"
import {
  AlertTriangleIcon,
  ExternalLinkIcon,
  LockIcon,
  LoaderCircleIcon,
  MonitorIcon,
  RefreshCwIcon,
} from "lucide-react"

import type { UserStory } from "@/components/backlog/data/backlog-data"
import { Button } from "@/components/ui/button"
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
  const [previewLoad, setPreviewLoad] = React.useState<PreviewLoad>({
    key: "",
    state: "loading",
  })
  const [reloadKey, setReloadKey] = React.useState(0)
  const frameRef = React.useRef<HTMLIFrameElement>(null)
  const locationIntervalRef = React.useRef<number | undefined>(undefined)
  const requestRef = React.useRef<AbortController | undefined>(undefined)
  const timeoutRef = React.useRef<number | undefined>(undefined)
  const source = userStory?.previewUrl
    ? previewSource(userStory.previewUrl)
    : undefined
  const previewKey = source ? `${source}-${reloadKey}` : ""
  const previewState =
    previewLoad.key === previewKey ? previewLoad.state : "loading"
  const previewLocation =
    previewLoad.key === previewKey ? previewLoad.location : undefined
  const locationBlocked =
    previewLoad.key === previewKey && previewLoad.locationBlocked

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
      ? previewFrameLocation(frameRef.current)
      : undefined
    if (!location) {
      setPreviewLoad((current) =>
        current.key === previewKey && current.locationBlocked
          ? current
          : {
              key: previewKey,
              location: current.key === previewKey ? current.location : undefined,
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
  }, [previewKey])

  React.useEffect(() => {
    if (!source) return
    clearPreviewRequest()
    clearLocationInterval()
    const controller = new AbortController()
    requestRef.current = controller
    timeoutRef.current = window.setTimeout(
      () => setPreviewLoad({ key: previewKey, location: source, state: "error" }),
      12000
    )
    void fetch(source, { mode: "no-cors", signal: controller.signal }).catch(
      () => {
        if (requestRef.current !== controller || controller.signal.aborted) return
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
    const target = previewLocation ?? source
    if (!target) return
    if (platform.openExternalLink) return platform.openExternalLink(target)
    window.open(target, "_blank", "noopener,noreferrer")
  }

  if (source) {
    return (
      <div className="flex h-full min-h-0 flex-col p-6">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-background">
          <div className="flex min-h-12 items-center gap-2 border-b bg-muted/30 px-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <MonitorIcon className="size-4 text-muted-foreground" />
              <span className="truncate text-sm text-muted-foreground">
                {previewLocation ?? source}
              </span>
              {locationBlocked && (
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-xs text-muted-foreground"
                  title="Le navigateur bloque l'URL interne de cette preview."
                >
                  <LockIcon className="size-3" />
                  URL interne masquée
                </span>
              )}
            </div>
            <Button
              size="sm"
              type="button"
              variant="ghost"
              onClick={reloadPreview}
            >
              <RefreshCwIcon />
              Reload
            </Button>
            <Button size="sm" type="button" onClick={openPreview}>
              <ExternalLinkIcon />
              Open in browser
            </Button>
          </div>
          <div className="relative min-h-96 flex-1 bg-muted/20">
            <iframe
              ref={frameRef}
              key={previewKey}
              className="h-full w-full bg-background"
              src={source}
              title={`${userStory?.id ?? "user-story"} preview`}
              onError={showPreviewError}
              onLoad={showPreview}
            />
            {previewState === "loading" && <PreviewLoadingState />}
            {previewState === "error" && (
              <PreviewErrorState onReload={reloadPreview} />
            )}
          </div>
        </div>
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

function previewFrameLocation(frame: HTMLIFrameElement) {
  try {
    return frame.contentWindow?.location.href
  } catch {
    return undefined
  }
}
