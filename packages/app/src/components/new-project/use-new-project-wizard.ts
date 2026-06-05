import * as React from "react"
import type { AgentEvent } from "@blame/agent-runtime"
import { toast } from "sonner"

import { useModelSelection } from "@/components/model/model-selector"
import { newProjectHostDependencyScript } from "@/components/new-project/new-project-host-dependencies"
import {
  defaultNewProjectConfiguration,
  normalizeNewProjectConfiguration,
  type AdvancedProjectOption,
  type BackendFramework,
  type CodeQualityOption,
  type DatabaseOption,
  type FrontendFramework,
  type NewProjectConfiguration,
  type OrmOption,
  type PackageManager,
  type ProjectPlatform,
  type StylingOption,
  type UiLibrary,
} from "@/components/new-project/new-project-options"
import { usePlatform } from "@/context/platform"
import type { HostDependencyReport } from "@/context/platform"
import { useProjects } from "@/context/projects"
import { useCloudAuth } from "@/context/cloud-auth"

export type NewProjectStep =
  | "location"
  | "platform"
  | "frontend"
  | "styling"
  | "backend"
  | "data"
  | "quality"
  | "advanced"
  | "summary"
  | "progress"

export type ProjectCreationLog = {
  type: "stdout" | "stderr" | "exit" | "agent"
  data: string
}

export type ProjectCreationStatus =
  | "idle"
  | "preparing"
  | "generating"
  | "installing"
  | "verifying"
  | "done"
  | "error"

const steps: NewProjectStep[] = [
  "location",
  "platform",
  "frontend",
  "styling",
  "backend",
  "data",
  "quality",
  "advanced",
  "summary",
]

export type NewProjectWizard = ReturnType<typeof useNewProjectWizard>

export function useNewProjectWizard(input: {
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const platform = usePlatform()
  const projects = useProjects()
  const auth = useCloudAuth()
  const modelSelection = useModelSelection()
  const [step, setStep] = React.useState<NewProjectStep>("location")
  const [parentPath, setParentPath] = React.useState("")
  const [projectName, setProjectName] = React.useState("")
  const [creating, setCreating] = React.useState(false)
  const [error, setError] = React.useState<string>()
  const [logs, setLogs] = React.useState<ProjectCreationLog[]>([])
  const [status, setStatus] = React.useState<ProjectCreationStatus>("idle")
  const [hostDependenciesDialog, setHostDependenciesDialog] =
    React.useState<HostDependenciesDialogState>()
  const [configuration, setConfiguration] =
    React.useState(defaultNewProjectConfiguration)
  const normalizedConfiguration = React.useMemo(
    () => normalizeNewProjectConfiguration(configuration),
    [configuration]
  )
  const currentStepIndex = Math.max(steps.indexOf(step), 0)
  const canGoBack = !creating && currentStepIndex > 0
  const canGoNext = !creating && nextStepAllowed(step, parentPath, projectName)
  const createProjectAvailable = Boolean(
    platform.workspace?.createProject && platform.agent && modelSelection.currentModel
  )

  const reset = React.useCallback(() => {
    setStep("location")
    setParentPath("")
    setProjectName("")
    setCreating(false)
    setError(undefined)
    setLogs([])
    setStatus("idle")
    setConfiguration(defaultNewProjectConfiguration)
  }, [])

  async function chooseParentPath() {
    const result = await platform.openDirectoryPickerDialog?.({
      title: "Choose New Project Location",
    })
    const path = Array.isArray(result) ? result[0] : result
    if (path) setParentPath(path)
  }

  function updateConfiguration(
    nextConfiguration: Partial<NewProjectConfiguration>
  ) {
    setConfiguration((current) =>
      normalizeNewProjectConfiguration({ ...current, ...nextConfiguration })
    )
  }

  function setPlatform(value: ProjectPlatform) {
    updateConfiguration({ platform: value })
  }

  function setFrontend(value: FrontendFramework) {
    updateConfiguration({ frontend: value, uiLibrary: defaultUi(value) })
  }

  function setStyling(value: StylingOption) {
    updateConfiguration({ styling: value })
  }

  function setUiLibrary(value: UiLibrary) {
    updateConfiguration({ uiLibrary: value })
  }

  function setBackend(value: BackendFramework) {
    updateConfiguration({ backend: value })
  }

  function setDatabase(value: DatabaseOption) {
    updateConfiguration({ database: value })
  }

  function setOrm(value: OrmOption) {
    updateConfiguration({ orm: value })
  }

  function setPackageManager(value: PackageManager) {
    updateConfiguration({ packageManager: value })
  }

  function setCodeQuality(value: CodeQualityOption) {
    updateConfiguration({ codeQuality: value })
  }

  function toggleAdvancedOption(value: AdvancedProjectOption) {
    setConfiguration((current) =>
      normalizeNewProjectConfiguration({
        ...current,
        advancedOptions: current.advancedOptions.includes(value)
          ? current.advancedOptions.filter((item) => item !== value)
          : [...current.advancedOptions, value],
      })
    )
  }

  function goBack() {
    const previousStep = steps[currentStepIndex - 1]
    if (previousStep) setStep(previousStep)
  }

  function goNext() {
    const nextStep = steps[currentStepIndex + 1]
    if (nextStep) setStep(nextStep)
  }

  async function createProject() {
    const workspace = platform.workspace
    if (!workspace?.createProject) {
      setError("Project creation is available only in the desktop app.")
      return
    }
    if (!workspace.checkHostDependencies) {
      setError("Desktop host dependency checks are not available.")
      return
    }

    setCreating(true)
    setError(undefined)
    setStatus("preparing")

    try {
      if (auth.status !== "authenticated") {
        throw new Error("Sign in to Blame before generating a project with the AI agent.")
      }
      if (!platform.agent || !modelSelection.currentModel) {
        throw new Error("Connect and select an AI model before generating a project.")
      }
      const setupScript = newProjectHostDependencyScript(normalizedConfiguration)
      const dependencies = await workspace.checkHostDependencies({ setupScript })
      if (!dependencies.ok) {
        setHostDependenciesDialog({
          checking: false,
          report: dependencies,
          setupScript,
        })
        setCreating(false)
        return
      }
      await runProjectCreation()
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Unable to check project requirements."
      )
      setStatus("error")
      setCreating(false)
    }
  }

  async function runProjectCreation() {
    const workspace = platform.workspace
    if (!workspace?.createProject) return
    setLogs([])
    setStep("progress")
    setStatus("preparing")

    const runId = crypto.randomUUID()
    const unsubscribe = workspace.onProjectCreationEvent?.(runId, (event) => {
      setLogs((current) => [...current, event])
      setStatus(statusFromProjectCreationEvent(event))
    })
    const unsubscribeAgent = platform.agent?.sessions.onEvent(runId, (event) => {
      const log = projectCreationLogFromAgentEvent(event)
      if (log) setLogs((current) => [...current, log])
      setStatus(statusFromAgentEvent(event))
      if (event.type === "error") {
        setError(eventText(event.payload) || "Project generation agent failed.")
      }
    })

    try {
      const currentModel = modelSelection.currentModel
      if (auth.status !== "authenticated" || !currentModel) {
        throw new Error("AI model selection is required to create a project.")
      }
      const result = await workspace.createProject({
        apiConnection: auth.apiConnection,
        configuration: normalizedConfiguration,
        modelId: currentModel.id,
        parentPath,
        projectName,
        providerId: currentModel.provider.id,
        reasoningEffort: modelSelection.currentVariant,
        runId,
      })
      await projects.openGeneratedProject(result.path, {
        dockerCompose: result.dockerCompose,
        setupScript: result.setupScript,
      })
      setOpen(false)
      toast.success("Project created", {
        description: `${projectName.trim()} is ready in Blame.`,
      })
      setStatus("done")
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to create project.")
      setStatus("error")
    } finally {
      unsubscribe?.()
      unsubscribeAgent?.()
      setCreating(false)
    }
  }

  async function recheckHostDependencies() {
    const current = hostDependenciesDialog
    const workspace = platform.workspace
    if (!current || !workspace?.checkHostDependencies) return
    setHostDependenciesDialog({ ...current, checking: true })
    try {
      const report = await workspace.checkHostDependencies({
        setupScript: current.setupScript,
      })
      if (report.ok) {
        setHostDependenciesDialog(undefined)
        setCreating(true)
        await runProjectCreation()
        return
      }
      setHostDependenciesDialog({ ...current, checking: false, report })
    } catch (error) {
      setHostDependenciesDialog({ ...current, checking: false })
      setError(
        error instanceof Error
          ? error.message
          : "Unable to recheck project requirements."
      )
      setStatus("error")
    }
  }

  function setOpen(open: boolean) {
    if (!open) reset()
    input.onOpenChange(open)
  }

  return {
    canGoBack,
    canGoNext,
    chooseParentPath,
    configuration: normalizedConfiguration,
    createProject,
    createProjectAvailable,
    creating,
    currentStepIndex,
    error,
    goBack,
    goNext,
    hostDependenciesDialog: {
      checking: Boolean(hostDependenciesDialog?.checking),
      onOpenChange(open: boolean) {
        if (!open) setHostDependenciesDialog(undefined)
      },
      onRecheck: recheckHostDependencies,
      open: Boolean(hostDependenciesDialog),
      report: hostDependenciesDialog?.report,
    },
    logs,
    parentPath,
    projectName,
    setBackend,
    setCodeQuality,
    setDatabase,
    setFrontend,
    setOrm,
    setPackageManager,
    setParentPath,
    setOpen,
    setPlatform,
    setProjectName,
    setStep,
    setStyling,
    setUiLibrary,
    step,
    steps,
    status,
    toggleAdvancedOption,
  }
}

type HostDependenciesDialogState = {
  checking: boolean
  report: HostDependencyReport
  setupScript: string
}

function nextStepAllowed(
  step: NewProjectStep,
  parentPath: string,
  projectName: string
) {
  if (step !== "location") return true
  return Boolean(parentPath.trim() && projectName.trim())
}

function defaultUi(frontend: FrontendFramework): UiLibrary {
  if (frontend === "nuxt") return "nuxt-ui"
  if (frontend === "vue-vite") return "primevue"
  if (frontend === "sveltekit") return "shadcn-svelte"
  if (frontend === "next" || frontend === "react-vite") return "shadcn"
  return "none"
}

function statusFromProjectCreationEvent(event: ProjectCreationLog): ProjectCreationStatus {
  if (event.type === "exit") return "done"
  if (/preparing/i.test(event.data)) return "preparing"
  if (/install|dependencies/i.test(event.data)) return "installing"
  if (/verify|build|lint|test|preview/i.test(event.data)) return "verifying"
  return "generating"
}

function statusFromAgentEvent(event: AgentEvent): ProjectCreationStatus {
  if (event.type === "done") return "done"
  if (event.type === "error") return "error"
  const text = eventText(event.payload)
  if (/install|dependencies/i.test(text)) return "installing"
  if (/verify|build|lint|test|preview/i.test(text)) return "verifying"
  return "generating"
}

function projectCreationLogFromAgentEvent(event: AgentEvent): ProjectCreationLog | undefined {
  const text = eventText(event.payload)
  if (!text) return undefined
  const prefix = event.type === "tool" ? "[tool] " : event.type === "reasoning" ? "[reasoning] " : ""
  return { type: event.type === "error" ? "stderr" : "agent", data: `${prefix}${text}\n` }
}

function eventText(payload: unknown): string {
  if (typeof payload === "string") return payload
  if (!payload || typeof payload !== "object") return ""
  const record = payload as Record<string, unknown>
  for (const key of ["message", "text", "accumulatedText", "reason", "error"]) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  const tool = record.toolName ?? record.name
  if (typeof tool === "string") return `Running ${tool}`
  return ""
}
