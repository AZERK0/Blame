import * as React from "react"
import { toast } from "sonner"

import { usePlatform } from "@/context/platform"
import { useProjects } from "@/context/projects"
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
  type: "stdout" | "stderr" | "exit"
  data: string
}

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
  const [step, setStep] = React.useState<NewProjectStep>("location")
  const [parentPath, setParentPath] = React.useState("")
  const [projectName, setProjectName] = React.useState("")
  const [creating, setCreating] = React.useState(false)
  const [error, setError] = React.useState<string>()
  const [logs, setLogs] = React.useState<ProjectCreationLog[]>([])
  const [configuration, setConfiguration] =
    React.useState(defaultNewProjectConfiguration)
  const normalizedConfiguration = React.useMemo(
    () => normalizeNewProjectConfiguration(configuration),
    [configuration]
  )
  const currentStepIndex = Math.max(steps.indexOf(step), 0)
  const canGoBack = !creating && currentStepIndex > 0
  const canGoNext = !creating && nextStepAllowed(step, parentPath, projectName)
  const createProjectAvailable = Boolean(platform.workspace?.createProject)

  const reset = React.useCallback(() => {
    setStep("location")
    setParentPath("")
    setProjectName("")
    setCreating(false)
    setError(undefined)
    setLogs([])
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
    updateConfiguration({
      advancedOptions: configuration.advancedOptions.includes(value)
        ? configuration.advancedOptions.filter((item) => item !== value)
        : [...configuration.advancedOptions, value],
    })
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

    setCreating(true)
    setError(undefined)
    setLogs([])
    setStep("progress")

    const runId = crypto.randomUUID()
    const unsubscribe = workspace.onProjectCreationEvent?.(runId, (event) => {
      setLogs((current) => [...current, event])
    })

    try {
      const result = await workspace.createProject({
        configuration: normalizedConfiguration,
        parentPath,
        projectName,
        runId,
      })
      await projects.openProject(result.path)
      setOpen(false)
      toast.success("Project created", {
        description: `${projectName.trim()} is ready in Blame.`,
      })
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to create project.")
    } finally {
      unsubscribe?.()
      setCreating(false)
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
    toggleAdvancedOption,
  }
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
