import * as React from "react"
import { ChevronRightIcon, DatabaseIcon, ServerIcon } from "lucide-react"
import { toast } from "sonner"

import {
  ModelSelector,
  type ModelSelection,
  useModelSelection,
} from "@/components/model/model-selector"
import type { ProjectInitializationDatabaseMode } from "@blame/agent-runtime"
import { Button } from "@/components/ui/button"
import { HostDependenciesDialog } from "@/pages/backlog/host-dependencies-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useCloudAuth } from "@/context/cloud-auth"
import {
  usePlatform,
  type HostDependencyReport,
  type WorkspaceClient,
} from "@/context/platform"
import { useProjects } from "@/context/projects"
import { CloudApiError, createCloudApi } from "@/lib/cloud-api"
import { notifyProjectInitializationUpdated } from "@/components/project-initialization/project-initialization-events"

const toastId = "project-initialization"
const maxBackendCompletionAttempts = 3

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
  credentialLabel?: string
  reasoningEffort?: ModelSelection["currentVariant"]
  preferences?: {
    database?: {
      mode: ProjectInitializationDatabaseMode
    }
  }
}

type InitializationValidationFeedback = {
  validationError: string
  previousResult: string
}

type InitializationAgentResult = Awaited<
  ReturnType<InitializationRunInput["agent"]["initializations"]["run"]>
>

type OpenHostDependenciesDialog = (
  run: InitializationRunInput,
  report: HostDependencyReport
) => void

export function ProjectInitializationRunner() {
  const controller = useProjectInitializationController()
  return (
    <>
      <InitializationModelDialog controller={controller} />
      <InitializationDatabaseDialog controller={controller} />
      <HostDependenciesDialog {...controller.hostDependenciesDialog} />
    </>
  )
}

function useProjectInitializationController() {
  const auth = useCloudAuth()
  const platform = usePlatform()
  const projects = useProjects()
  const selection = useModelSelection({ role: "alternative" })
  const activeProject = projects.activeProject
  const currentModel = selection.currentModel
  const initializationAuth = React.useMemo(
    () => ({ apiConnection: auth.apiConnection, status: auth.status }),
    [auth.apiConnection, auth.status]
  )
  const dialog = useModelDialogState(activeProject?.id)
  const databaseDialog = useDatabaseDialogState()
  const hostDependenciesDialog = useHostDependenciesDialogState(
    platform.workspace,
    databaseDialog.openDatabaseDialog
  )

  useInitializationEffect(
    activeProject,
    platform.agent,
    platform.workspace,
    initializationAuth,
    currentModel,
    selection.currentVariant,
    dialog.openModelDialog,
    databaseDialog.openDatabaseDialog,
    hostDependenciesDialog.openHostDependenciesDialog
  )

  return initializationController({
    activeProject,
    agent: platform.agent,
    auth: initializationAuth,
    currentModel,
    currentVariant: selection.currentVariant,
    databaseDialog,
    dialog,
    hostDependenciesDialog,
    removeRecentProject: projects.removeRecentProject,
    workspace: platform.workspace,
    refreshProviders: selection.refreshProviders,
  })
}

function initializationController(input: {
  activeProject: InitializationRunInput["project"] | undefined
  agent: InitializationRunInput["agent"] | undefined
  auth: InitializationAuth
  currentModel: ModelSelection["currentModel"]
  currentVariant: ModelSelection["currentVariant"]
  databaseDialog: ReturnType<typeof useDatabaseDialogState>
  dialog: ReturnType<typeof useModelDialogState>
  hostDependenciesDialog: ReturnType<typeof useHostDependenciesDialogState>
  removeRecentProject: (path: string) => void
  workspace: WorkspaceClient | undefined
  refreshProviders: () => Promise<void>
}) {
  const cancelDatabaseChoice = () => {
    const project = input.databaseDialog.pendingRun?.project
    input.databaseDialog.setOpen(false)
    if (project) input.removeRecentProject(project.path)
  }

  return {
    activeProjectId: input.activeProject?.id,
    currentModelName: input.currentModel?.name,
    hasModel: Boolean(input.currentModel),
    modelDialogOpen: input.dialog.modelDialogOpen,
    pendingProjectId: input.dialog.pendingProjectId,
    databaseDialogOpen: input.databaseDialog.open,
    hostDependenciesDialog: input.hostDependenciesDialog.dialog,
    cancelDatabaseChoice,
    refreshProviders: input.refreshProviders,
    selectDatabaseMode: input.databaseDialog.selectDatabaseMode,
    setModelDialogOpen: input.dialog.setModelDialogOpen,
    setDatabaseDialogOpen: (open: boolean) => {
      if (!open) cancelDatabaseChoice()
    },
    startWithSelectedModel: () =>
      startSelectedModel(
        input.activeProject,
        input.auth,
        input.agent,
        input.currentModel,
        input.currentVariant,
        input.dialog.closeModelDialog,
        input.workspace,
        input.databaseDialog.openDatabaseDialog,
        input.hostDependenciesDialog.openHostDependenciesDialog
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

function useDatabaseDialogState() {
  const [pendingRun, setPendingRun] = React.useState<InitializationRunInput>()
  const openDatabaseDialog = React.useCallback((run: InitializationRunInput) => {
    setPendingRun(run)
  }, [])
  const setOpen = React.useCallback((open: boolean) => {
    if (!open) setPendingRun(undefined)
  }, [])
  const selectDatabaseMode = React.useCallback(
    (mode: ProjectInitializationDatabaseMode) => {
      const run = pendingRun
      if (!run) return
      setPendingRun(undefined)
      void runInitialization({
        ...run,
        preferences: {
          ...run.preferences,
          database: { mode },
        },
      })
    },
    [pendingRun]
  )

  return {
    open: Boolean(pendingRun),
    openDatabaseDialog,
    pendingRun,
    selectDatabaseMode,
    setOpen,
  }
}

function useHostDependenciesDialogState(
  workspace: WorkspaceClient | undefined,
  openDatabaseDialog: (run: InitializationRunInput) => void
) {
  const [pendingRun, setPendingRun] = React.useState<InitializationRunInput>()
  const [report, setReport] = React.useState<HostDependencyReport>()
  const [checking, setChecking] = React.useState(false)

  const openHostDependenciesDialog = React.useCallback(
    (run: InitializationRunInput, nextReport: HostDependencyReport) => {
      setPendingRun(run)
      setReport(nextReport)
      setChecking(false)
    },
    []
  )

  async function recheck() {
    if (!workspace || !pendingRun) return
    setChecking(true)
    try {
      const nextReport = await checkInitializationHostDependencies(workspace)
      if (!nextReport.ok) {
        setReport(nextReport)
        return
      }
      const run = pendingRun
      setPendingRun(undefined)
      setReport(undefined)
      await startInitialization(run, workspace, openDatabaseDialog, undefined)
    } finally {
      setChecking(false)
    }
  }

  return {
    dialog: {
      checking,
      onOpenChange(open: boolean) {
        if (!open) {
          setPendingRun(undefined)
          setReport(undefined)
        }
      },
      onRecheck: recheck,
      open: Boolean(pendingRun),
      report,
    },
    openHostDependenciesDialog,
  }
}

function startSelectedModel(
  project: InitializationRunInput["project"] | undefined,
  auth: InitializationAuth,
  agent: InitializationRunInput["agent"] | undefined,
  model: ModelSelection["currentModel"],
  variant: ModelSelection["currentVariant"],
  closeModelDialog: () => void,
  workspace: WorkspaceClient | undefined,
  openDatabaseDialog: (run: InitializationRunInput) => void,
  openHostDependenciesDialog: OpenHostDependenciesDialog | undefined
) {
  const input = runInput(project, auth, agent, model, variant)
  if (!input) return
  closeModelDialog()
  void startInitialization(
    input,
    workspace,
    openDatabaseDialog,
    openHostDependenciesDialog
  )
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

function InitializationDatabaseDialog({
  controller,
}: {
  controller: ReturnType<typeof useProjectInitializationController>
}) {
  return (
    <Dialog
      open={controller.databaseDialogOpen}
      onOpenChange={controller.setDatabaseDialogOpen}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Database for this preview</DialogTitle>
          <DialogDescription>
            This project already has database configuration in its environment.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-auto justify-start gap-3 px-3 py-3 text-left"
            onClick={() => controller.selectDatabaseMode("existing")}
          >
            <ServerIcon className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1">Use configured database</span>
            <ChevronRightIcon className="size-4 text-muted-foreground" />
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-auto justify-start gap-3 px-3 py-3 text-left"
            onClick={() => controller.selectDatabaseMode("compose")}
          >
            <DatabaseIcon className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1">Create isolated database</span>
            <ChevronRightIcon className="size-4 text-muted-foreground" />
          </Button>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={controller.cancelDatabaseChoice}
          >
            Cancel
          </Button>
        </DialogFooter>
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
      <ModelSelector role="alternative" />
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
  workspace: WorkspaceClient | undefined,
  auth: InitializationAuth,
  currentModel: ModelSelection["currentModel"],
  currentVariant: ModelSelection["currentVariant"],
  openModelDialog: () => void,
  openDatabaseDialog: (run: InitializationRunInput) => void,
  openHostDependenciesDialog: OpenHostDependenciesDialog | undefined
) {
  React.useEffect(
    () =>
      initializationEffect({
        activeProject,
        agent,
        workspace,
        auth,
        currentModel,
        currentVariant,
        openModelDialog,
        openDatabaseDialog,
        openHostDependenciesDialog,
      }),
    [
      activeProject,
      agent,
      workspace,
      auth,
      currentModel,
      currentVariant,
      openModelDialog,
      openDatabaseDialog,
      openHostDependenciesDialog,
    ]
  )
}

function initializationEffect(input: {
  activeProject?: { id: string; name: string; path: string }
  agent?: NonNullable<ReturnType<typeof usePlatform>["agent"]>
  workspace?: WorkspaceClient
  auth: InitializationAuth
  currentModel: ModelSelection["currentModel"]
  currentVariant: ModelSelection["currentVariant"]
  openModelDialog: () => void
  openDatabaseDialog: (run: InitializationRunInput) => void
  openHostDependenciesDialog: OpenHostDependenciesDialog | undefined
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
    input.currentModel,
    input.currentVariant
  )
  if (!run) return input.openModelDialog()
  await startInitialization(
    run,
    input.workspace,
    input.openDatabaseDialog,
    input.openHostDependenciesDialog
  )
}

function runInput(
  project: InitializationRunInput["project"] | undefined,
  auth: InitializationAuth,
  agent: InitializationRunInput["agent"] | undefined,
  model: ModelSelection["currentModel"],
  variant: ModelSelection["currentVariant"]
): InitializationRunInput | undefined {
  if (!project || !model || auth.status !== "authenticated" || !agent) return
  return {
    project,
    auth,
    agent,
    providerId: model.provider.id,
    modelId: model.id,
    credentialLabel: model.credentialLabel,
    reasoningEffort: variant,
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

async function startInitialization(
  input: InitializationRunInput,
  workspace: WorkspaceClient | undefined,
  openDatabaseDialog: (run: InitializationRunInput) => void,
  openHostDependenciesDialog: OpenHostDependenciesDialog | undefined
) {
  const report = workspace
    ? await checkInitializationHostDependencies(workspace)
    : undefined
  if (report && !report.ok) {
    openHostDependenciesDialog?.(input, report)
    return
  }
  if (await projectNeedsDatabaseChoice(input.project, workspace)) {
    openDatabaseDialog(input)
    return
  }
  await runInitialization(input)
}

function checkInitializationHostDependencies(workspace: WorkspaceClient) {
  return workspace.checkHostDependencies({ setupScript: "" })
}

async function persistInitializationResult(
  input: InitializationRunInput,
  cloud: ReturnType<typeof createCloudApi>
) {
  await cloud.startProjectInitialization(input.project.id, {
    providerId: input.providerId,
    modelId: input.modelId,
  })
  let feedback: InitializationValidationFeedback | undefined
  for (let attempt = 1; attempt <= maxBackendCompletionAttempts; attempt += 1) {
    const result = await runProjectInitializationAgent(input, feedback)
    try {
      await completeProjectInitialization(input, cloud, result)
      showSuccess()
      return
    } catch (error) {
      if (!shouldRetryBackendValidation(error, attempt)) throw error
      feedback = validationFeedback(error, result)
    }
  }
}

function runProjectInitializationAgent(
  input: InitializationRunInput,
  validationFeedback?: InitializationValidationFeedback
) {
  return input.agent.initializations.run({
    apiConnection: input.auth.apiConnection,
    providerId: input.providerId,
    modelId: input.modelId,
    credentialLabel: input.credentialLabel,
    reasoningEffort: input.reasoningEffort,
    cwd: input.project.path,
    workspaceRoot: input.project.path,
    preferences: input.preferences,
    validationFeedback,
  })
}

async function completeProjectInitialization(
  input: InitializationRunInput,
  cloud: ReturnType<typeof createCloudApi>,
  result: InitializationAgentResult
) {
  await cloud.completeProjectInitialization(input.project.id, {
    clineSessionId: result.sessionId,
    previewManifest: result.previewManifest,
    setupScript: result.setupScript,
    dockerCompose: result.dockerCompose,
    runConfigurations: result.runConfigurations,
    practices: result.practices,
  })
  notifyProjectInitializationUpdated(input.project.id)
}

function shouldRetryBackendValidation(error: unknown, attempt: number) {
  return (
    attempt < maxBackendCompletionAttempts && isBackendValidationError(error)
  )
}

function isBackendValidationError(error: unknown) {
  return error instanceof CloudApiError && [400, 422].includes(error.status)
}

function validationFeedback(
  error: unknown,
  result: InitializationAgentResult
): InitializationValidationFeedback {
  return {
    validationError: errorMessage(error),
    previousResult: JSON.stringify({
      previewManifest: result.previewManifest,
      setupScript: result.setupScript,
      dockerCompose: result.dockerCompose,
      runConfigurations: result.runConfigurations,
      practices: result.practices,
    }),
  }
}

async function projectNeedsDatabaseChoice(
  project: InitializationRunInput["project"],
  workspace: WorkspaceClient | undefined
) {
  if (!workspace) return false
  const files = await Promise.all(
    databaseDetectionFiles.map((path) =>
      readWorkspaceFile(workspace, project.path, path)
    )
  )
  return files.some((content) => databaseContentPattern.test(content))
}

async function readWorkspaceFile(
  workspace: WorkspaceClient,
  root: string,
  path: string
) {
  try {
    return await workspace.readFile({ root, path })
  } catch {
    return ""
  }
}

const databaseDetectionFiles = [
  ".env",
  ".env.example",
  ".env.local",
  "package.json",
  "prisma/schema.prisma",
  "drizzle.config.ts",
  "drizzle.config.js",
  "apps/api/.env",
  "apps/api/.env.example",
  "apps/api/package.json",
  "apps/api/config/database.ts",
  "apps/api/start/env.ts",
  "apps/backend/.env",
  "apps/backend/.env.example",
  "apps/backend/package.json",
  "apps/backend/config/database.ts",
  "apps/backend/start/env.ts",
]

const databaseContentPattern =
  /\b(?:DATABASE_URL|DB_HOST|DB_DATABASE|MYSQL_|POSTGRES_|MONGODB_URI|@adonisjs\/lucid|prisma|drizzle-orm|typeorm|sequelize|mongoose|knex|mysql2|pg)\b/i

async function persistInitializationError(
  input: InitializationRunInput,
  cloud: ReturnType<typeof createCloudApi>,
  error: unknown
) {
  await cloud
    .failProjectInitialization(input.project.id, { error: errorMessage(error) })
    .catch(() => undefined)
  notifyProjectInitializationUpdated(input.project.id)
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
