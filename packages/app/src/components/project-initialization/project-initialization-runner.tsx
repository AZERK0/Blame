import * as React from "react"
import { toast } from "sonner"

import {
  ModelSelector,
  type ModelSelection,
  useModelSelection,
} from "@/components/model/model-selector"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useCloudAuth } from "@/context/cloud-auth"
import { usePlatform } from "@/context/platform"
import { useProjects } from "@/context/projects"
import { createCloudApi } from "@/lib/cloud-api"

const toastId = "project-initialization"

type InitializationAuth = Pick<
  ReturnType<typeof useCloudAuth>,
  "apiConnection" | "status"
>

type InitializationRunInput = {
  project: { id: string; name: string; path: string }
  auth: InitializationAuth
  agent: NonNullable<ReturnType<typeof usePlatform>["agent"]>
  providerId: string
  modelId: string
}

export function ProjectInitializationRunner() {
  const controller = useProjectInitializationController()
  return <InitializationModelDialog controller={controller} />
}

function useProjectInitializationController() {
  const auth = useCloudAuth()
  const platform = usePlatform()
  const projects = useProjects()
  const selection = useModelSelection()
  const activeProject = projects.activeProject
  const currentModel = selection.currentModel
  const initializationAuth = React.useMemo(
    () => ({ apiConnection: auth.apiConnection, status: auth.status }),
    [auth.apiConnection, auth.status]
  )
  const dialog = useModelDialogState(activeProject?.id)

  useInitializationEffect(
    activeProject,
    platform.agent,
    initializationAuth,
    currentModel,
    dialog.openModelDialog
  )

  return initializationController({
    activeProject,
    agent: platform.agent,
    auth: initializationAuth,
    currentModel,
    dialog,
    refreshProviders: selection.refreshProviders,
  })
}

function initializationController(input: {
  activeProject: InitializationRunInput["project"] | undefined
  agent: InitializationRunInput["agent"] | undefined
  auth: InitializationAuth
  currentModel: ModelSelection["currentModel"]
  dialog: ReturnType<typeof useModelDialogState>
  refreshProviders: () => Promise<void>
}) {
  return {
    activeProjectId: input.activeProject?.id,
    currentModelName: input.currentModel?.name,
    hasModel: Boolean(input.currentModel),
    modelDialogOpen: input.dialog.modelDialogOpen,
    pendingProjectId: input.dialog.pendingProjectId,
    refreshProviders: input.refreshProviders,
    setModelDialogOpen: input.dialog.setModelDialogOpen,
    startWithSelectedModel: () =>
      startSelectedModel(
        input.activeProject,
        input.auth,
        input.agent,
        input.currentModel,
        input.dialog.closeModelDialog
      ),
  }
}

function useModelDialogState(activeProjectId: string | undefined) {
  const [modelDialogOpen, setModelDialogOpen] = React.useState(false)
  const [pendingProjectId, setPendingProjectId] = React.useState<string>()
  const openModelDialog = React.useCallback(() => {
    setPendingProjectId(activeProjectId)
    setModelDialogOpen(true)
  }, [activeProjectId])
  const closeModelDialog = React.useCallback(() => {
    setModelDialogOpen(false)
    setPendingProjectId(undefined)
  }, [])

  return {
    closeModelDialog,
    modelDialogOpen,
    openModelDialog,
    pendingProjectId,
    setModelDialogOpen,
  }
}

function startSelectedModel(
  project: InitializationRunInput["project"] | undefined,
  auth: InitializationAuth,
  agent: InitializationRunInput["agent"] | undefined,
  model: ModelSelection["currentModel"],
  closeModelDialog: () => void
) {
  const input = runInput(project, auth, agent, model)
  if (!input) return
  closeModelDialog()
  void runInitialization(input)
}

function InitializationModelDialog({
  controller,
}: {
  controller: ReturnType<typeof useProjectInitializationController>
}) {
  return (
    <Dialog
      open={
        controller.modelDialogOpen &&
        controller.pendingProjectId === controller.activeProjectId
      }
      onOpenChange={controller.setModelDialogOpen}
    >
      <DialogContent>
        <InitializationModelDialogHeader />
        <InitializationModelPicker modelName={controller.currentModelName} />
        <InitializationModelDialogFooter controller={controller} />
      </DialogContent>
    </Dialog>
  )
}

function InitializationModelDialogHeader() {
  return (
    <DialogHeader>
      <DialogTitle>Choose initialization model</DialogTitle>
      <DialogDescription>
        Blame needs a connected model to analyze this project and prepare its
        worktree setup.
      </DialogDescription>
    </DialogHeader>
  )
}

function InitializationModelPicker({ modelName }: { modelName?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <span className="min-w-0 text-sm text-muted-foreground">
        {modelName ?? "No model selected"}
      </span>
      <ModelSelector />
    </div>
  )
}

function InitializationModelDialogFooter({
  controller,
}: {
  controller: ReturnType<typeof useProjectInitializationController>
}) {
  return (
    <DialogFooter>
      <Button
        type="button"
        disabled={!controller.hasModel}
        onClick={controller.startWithSelectedModel}
      >
        Start initialization
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => void controller.refreshProviders()}
      >
        Refresh models
      </Button>
    </DialogFooter>
  )
}

function useInitializationEffect(
  activeProject: { id: string; name: string; path: string } | undefined,
  agent: NonNullable<ReturnType<typeof usePlatform>["agent"]> | undefined,
  auth: InitializationAuth,
  currentModel: ModelSelection["currentModel"],
  openModelDialog: () => void
) {
  React.useEffect(
    () =>
      initializationEffect({
        activeProject,
        agent,
        auth,
        currentModel,
        openModelDialog,
      }),
    [activeProject, agent, auth, currentModel, openModelDialog]
  )
}

function initializationEffect(input: {
  activeProject?: { id: string; name: string; path: string }
  agent?: NonNullable<ReturnType<typeof usePlatform>["agent"]>
  auth: InitializationAuth
  currentModel: ModelSelection["currentModel"]
  openModelDialog: () => void
}) {
  if (!input.activeProject || input.auth.status !== "authenticated") return
  if (!input.agent) return
  const controller = new AbortController()
  void maybeInitializeProject(input, controller.signal)
  return () => controller.abort()
}

async function maybeInitializeProject(
  input: Required<Parameters<typeof initializationEffect>[0]>,
  signal: AbortSignal
) {
  const cloud = createCloudApi(input.auth.apiConnection)
  const snapshot = await cloud.projectInitialization(input.activeProject.id)
  if (signal.aborted || completed(snapshot.initialization?.status)) return
  const run = runInput(
    input.activeProject,
    input.auth,
    input.agent,
    input.currentModel
  )
  if (!run) return input.openModelDialog()
  await runInitialization(run)
}

function runInput(
  project: InitializationRunInput["project"] | undefined,
  auth: InitializationAuth,
  agent: InitializationRunInput["agent"] | undefined,
  model: ModelSelection["currentModel"]
): InitializationRunInput | undefined {
  if (!project || !model || auth.status !== "authenticated" || !agent) return
  return {
    project,
    auth,
    agent,
    providerId: model.provider.id,
    modelId: model.id,
  }
}

async function runInitialization(input: InitializationRunInput) {
  const cloud = createCloudApi(input.auth.apiConnection)
  toast.loading(`Initializing ${input.project.name}`, {
    description: "Blame is analyzing project setup and code practices.",
    id: toastId,
    position: "bottom-right",
  })

  await persistInitializationResult(input, cloud).catch((error) =>
    persistInitializationError(input, cloud, error)
  )
}

async function persistInitializationResult(
  input: InitializationRunInput,
  cloud: ReturnType<typeof createCloudApi>
) {
  await cloud.startProjectInitialization(input.project.id, {
    providerId: input.providerId,
    modelId: input.modelId,
  })
  const result = await input.agent.initializations.run({
    apiConnection: input.auth.apiConnection,
    providerId: input.providerId,
    modelId: input.modelId,
    cwd: input.project.path,
    workspaceRoot: input.project.path,
  })
  await cloud.completeProjectInitialization(input.project.id, {
    clineSessionId: result.sessionId,
    setupScript: result.setupScript,
    dockerCompose: result.dockerCompose,
    practices: result.practices,
  })
  showSuccess()
}

async function persistInitializationError(
  input: InitializationRunInput,
  cloud: ReturnType<typeof createCloudApi>,
  error: unknown
) {
  await cloud
    .failProjectInitialization(input.project.id, { error: errorMessage(error) })
    .catch(() => undefined)
  showError(error)
}

function completed(status: string | undefined) {
  return status === "running" || status === "done"
}

function showError(error: unknown) {
  toast.error("Project initialization failed", {
    description: errorMessage(error),
    id: toastId,
    position: "bottom-right",
  })
}

function showSuccess() {
  toast.success("Project initialized", {
    description: "Worktree setup and code practices were saved.",
    id: toastId,
    position: "bottom-right",
  })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to initialize project"
}
