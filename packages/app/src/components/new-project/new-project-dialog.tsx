import * as React from "react"
import {
  CheckCircle2Icon,
  FolderIcon,
  LoaderCircleIcon,
  SparklesIcon,
} from "lucide-react"

import {
  advancedOptionLabels,
  backendOptions,
  codeQualityOptions,
  databaseOptions,
  frontendOptions,
  optionLabel,
  ormOptions,
  packageManagerOptions,
  platformOptions,
  requiresTailwind,
  stylingOptions,
  uiLibraryOptions,
  type AdvancedProjectOption,
  type NewProjectOption,
} from "@/components/new-project/new-project-options"
import {
  useNewProjectWizard,
  type NewProjectStep,
  type NewProjectWizard,
} from "@/components/new-project/use-new-project-wizard"
import { HostDependenciesDialog } from "@/pages/backlog/host-dependencies-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

export function NewProjectDialog({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const wizard = useNewProjectWizard({ onOpenChange, open })

  return (
    <>
      <Dialog open={open} onOpenChange={wizard.setOpen}>
        <DialogContent className="max-h-[88vh] overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle>New Project</DialogTitle>
            <DialogDescription>
              Generate a codebase ready for Blame workflows.
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 gap-5 overflow-y-auto px-5 py-4">
            <StepProgress wizard={wizard} />
            <StepContent wizard={wizard} />
          </div>
          <WizardFooter wizard={wizard} />
        </DialogContent>
      </Dialog>
      <HostDependenciesDialog {...wizard.hostDependenciesDialog} />
    </>
  )
}

function StepProgress({ wizard }: { wizard: NewProjectWizard }) {
  if (wizard.step === "progress") return null

  return (
    <div className="grid grid-cols-4 gap-1 sm:grid-cols-9">
      {wizard.steps.map((step, index) => (
        <button
          key={step}
          type="button"
          disabled={wizard.creating || index > wizard.currentStepIndex}
          className={cn(
            "h-1.5 rounded-full bg-muted transition-colors",
            index <= wizard.currentStepIndex && "bg-primary"
          )}
          onClick={() => wizard.setStep(step)}
        >
          <span className="sr-only">{stepLabel(step)}</span>
        </button>
      ))}
    </div>
  )
}

function StepContent({ wizard }: { wizard: NewProjectWizard }) {
  if (wizard.step === "location") return <LocationStep wizard={wizard} />
  if (wizard.step === "platform") return <PlatformStep wizard={wizard} />
  if (wizard.step === "frontend") return <FrontendStep wizard={wizard} />
  if (wizard.step === "styling") return <StylingStep wizard={wizard} />
  if (wizard.step === "backend") return <BackendStep wizard={wizard} />
  if (wizard.step === "data") return <DataStep wizard={wizard} />
  if (wizard.step === "quality") return <QualityStep wizard={wizard} />
  if (wizard.step === "advanced") return <AdvancedStep wizard={wizard} />
  if (wizard.step === "progress") return <ProgressStep wizard={wizard} />
  return <SummaryStep wizard={wizard} />
}

function LocationStep({ wizard }: { wizard: NewProjectWizard }) {
  return (
    <StepFrame
      title="Location"
      description="Choose where Blame should create the project."
    >
      <div className="grid gap-4 rounded-xl border bg-background/45 p-4">
        <Field>
          <FieldLabel htmlFor="new-project-parent">Parent folder</FieldLabel>
          <FieldDescription>
            Pick the folder that will contain the generated project.
          </FieldDescription>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <Input
              id="new-project-parent"
              className="h-9 bg-background/70"
              value={wizard.parentPath}
              placeholder="/path/to/projects"
              onChange={(event) =>
                wizard.setParentPath(event.currentTarget.value)
              }
            />
            <Button
              type="button"
              variant="outline"
              className="h-9"
              onClick={() => void wizard.chooseParentPath()}
            >
              <FolderIcon />
              Browse
            </Button>
          </div>
        </Field>
        <Field>
          <FieldLabel htmlFor="new-project-name">Project name</FieldLabel>
          <FieldDescription>
            Use a short, readable folder name for the new codebase.
          </FieldDescription>
          <Input
            id="new-project-name"
            className="h-9 bg-background/70"
            value={wizard.projectName}
            placeholder="my-blame-project"
            onChange={(event) =>
              wizard.setProjectName(event.currentTarget.value)
            }
          />
        </Field>
        <ProjectPathPreview wizard={wizard} />
      </div>
      {!wizard.createProjectAvailable ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          Project generation requires the desktop app and a connected AI model.
        </p>
      ) : null}
    </StepFrame>
  )
}

function ProjectPathPreview({ wizard }: { wizard: NewProjectWizard }) {
  const parentPath = wizard.parentPath.trim() || "/path/to/projects"
  const projectName = wizard.projectName.trim() || "my-blame-project"

  return (
    <div className="grid gap-1 rounded-lg bg-muted/35 p-3">
      <span className="text-xs font-medium text-foreground/70">
        Project path
      </span>
      <span className="truncate font-mono text-xs text-foreground/60">
        {parentPath}/{projectName}
      </span>
    </div>
  )
}

function PlatformStep({ wizard }: { wizard: NewProjectWizard }) {
  return (
    <StepFrame
      title="Platform"
      description="Choose the kind of project to generate."
    >
      <OptionGrid
        options={platformOptions}
        value={wizard.configuration.platform}
        onChange={wizard.setPlatform}
      />
    </StepFrame>
  )
}

function FrontendStep({ wizard }: { wizard: NewProjectWizard }) {
  return (
    <StepFrame
      title="Frontend framework"
      description="The frontend choice drives the rest of the wizard."
    >
      <OptionGrid
        options={frontendOptions}
        value={wizard.configuration.frontend}
        onChange={wizard.setFrontend}
      />
    </StepFrame>
  )
}

function StylingStep({ wizard }: { wizard: NewProjectWizard }) {
  const uiOptions = uiLibraryOptions(wizard.configuration.frontend)

  return (
    <StepFrame
      title="Styling and UI"
      description="Configure styling separately from the component library."
    >
      <OptionGrid
        options={stylingOptions.map((option) => ({
          ...option,
          disabled:
            wizard.configuration.frontend === "none" ||
            (option.value !== "tailwind" &&
              requiresTailwind(wizard.configuration.uiLibrary)),
        }))}
        value={wizard.configuration.styling}
        onChange={wizard.setStyling}
      />
      <SelectField
        label="UI library"
        options={uiOptions}
        value={wizard.configuration.uiLibrary}
        onChange={wizard.setUiLibrary}
      />
    </StepFrame>
  )
}

function BackendStep({ wizard }: { wizard: NewProjectWizard }) {
  return (
    <StepFrame
      title="Backend framework"
      description="Choose the backend shape Blame should scaffold."
    >
      <OptionGrid
        options={backendOptions(wizard.configuration.frontend)}
        value={wizard.configuration.backend}
        onChange={wizard.setBackend}
      />
    </StepFrame>
  )
}

function DataStep({ wizard }: { wizard: NewProjectWizard }) {
  return (
    <StepFrame
      title="Database and ORM"
      description="Pick the persistence layer for the generated project."
    >
      <OptionGrid
        options={databaseOptions}
        value={wizard.configuration.database}
        onChange={wizard.setDatabase}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="ORM / query layer"
          options={ormOptions(
            wizard.configuration.backend,
            wizard.configuration.database
          )}
          value={wizard.configuration.orm}
          onChange={wizard.setOrm}
        />
        <SelectField
          label="Package manager / runtime"
          options={packageManagerOptions(wizard.configuration.backend)}
          value={wizard.configuration.packageManager}
          onChange={wizard.setPackageManager}
        />
      </div>
    </StepFrame>
  )
}

function QualityStep({ wizard }: { wizard: NewProjectWizard }) {
  return (
    <StepFrame
      title="Code quality"
      description="Configure linting, formatting and project hygiene."
    >
      <OptionGrid
        options={codeQualityOptions(
          wizard.configuration.frontend,
          wizard.configuration.backend
        )}
        value={wizard.configuration.codeQuality}
        onChange={wizard.setCodeQuality}
      />
    </StepFrame>
  )
}

function AdvancedStep({ wizard }: { wizard: NewProjectWizard }) {
  const options = Object.entries(advancedOptionLabels) as Array<
    [AdvancedProjectOption, string]
  >

  return (
    <StepFrame
      title="Advanced options"
      description="Enable the project extras Blame should prepare."
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map(([value, label]) => (
          <label
            key={value}
            className="flex items-center justify-between gap-3 rounded-lg border p-3"
          >
            <span className="text-sm font-medium">{label}</span>
            <Switch
              checked={wizard.configuration.advancedOptions.includes(value)}
              onCheckedChange={() => wizard.toggleAdvancedOption(value)}
            />
          </label>
        ))}
      </div>
    </StepFrame>
  )
}

function SummaryStep({ wizard }: { wizard: NewProjectWizard }) {
  const items = summaryItems(wizard)

  return (
    <StepFrame
      title="Summary"
      description="Review the project before Blame generates it."
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.label} className="rounded-lg border bg-muted/30 p-3">
            <div className="text-xs font-medium text-muted-foreground">
              {item.label}
            </div>
            <div className="mt-1 text-sm font-medium">{item.value}</div>
          </div>
        ))}
      </div>
    </StepFrame>
  )
}

function ProgressStep({ wizard }: { wizard: NewProjectWizard }) {
  const status = progressStatus(wizard.status)
  return (
    <StepFrame
      title="Generating project"
      description="Blame is running a dedicated AI agent to generate and verify the codebase."
    >
      <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
        {wizard.creating ? (
          <LoaderCircleIcon className="size-5 animate-spin text-primary" />
        ) : (
          <CheckCircle2Icon className="size-5 text-primary" />
        )}
        <span className="text-sm font-medium">{status}</span>
      </div>
      {wizard.error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {wizard.error}
        </p>
      ) : null}
      <pre className="max-h-80 overflow-auto rounded-lg border bg-background p-3 text-xs">
        {wizard.logs.length
          ? wizard.logs.map((event) => event.data).join("")
          : "Waiting for agent output..."}
      </pre>
    </StepFrame>
  )
}

function progressStatus(status: NewProjectWizard["status"]) {
  if (status === "preparing") return "Preparation"
  if (status === "generating") return "AI generation"
  if (status === "installing") return "Installing dependencies"
  if (status === "verifying") return "Verification"
  if (status === "error") return "Generation failed"
  if (status === "done") return "Generation finished"
  return "Waiting to start"
}

function WizardFooter({ wizard }: { wizard: NewProjectWizard }) {
  if (wizard.step === "progress") {
    return (
      <DialogFooter className="mx-0 mb-0 gap-2 rounded-b-xl bg-muted/30 px-5 py-4">
        <Button
          type="button"
          variant="outline"
          disabled={wizard.creating}
          onClick={() => wizard.setStep("summary")}
        >
          Back to summary
        </Button>
      </DialogFooter>
    )
  }

  return (
    <DialogFooter className="mx-0 mb-0 gap-2 rounded-b-xl bg-muted/30 px-5 py-4">
      <Button
        type="button"
        variant="outline"
        disabled={!wizard.canGoBack}
        onClick={wizard.goBack}
      >
        Back
      </Button>
      {wizard.step === "summary" ? (
        <Button
          type="button"
          disabled={wizard.creating || !wizard.createProjectAvailable}
          onClick={() => void wizard.createProject()}
        >
          <SparklesIcon />
          Create project
        </Button>
      ) : (
        <Button
          type="button"
          disabled={!wizard.canGoNext}
          onClick={wizard.goNext}
        >
          Continue
        </Button>
      )}
    </DialogFooter>
  )
}

function OptionGrid<T extends string>({
  onChange,
  options,
  value,
}: {
  onChange: (value: T) => void
  options: NewProjectOption<T>[]
  value: T
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={option.disabled}
          data-selected={value === option.value}
          className="grid gap-1 rounded-lg border p-3 text-left transition-colors disabled:opacity-50 data-[selected=true]:border-primary data-[selected=true]:bg-primary/5"
          onClick={() => onChange(option.value)}
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            {option.label}
            {option.recommended ? (
              <Badge variant="secondary">Recommended</Badge>
            ) : null}
          </span>
          <span className="text-xs text-muted-foreground">
            {option.description}
          </span>
        </button>
      ))}
    </div>
  )
}

function SelectField<T extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string
  onChange: (value: T) => void
  options: NewProjectOption<T>[]
  value: T
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Select
        value={value}
        onValueChange={(nextValue) => onChange(nextValue as T)}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>
        {options.find((option) => option.value === value)?.description}
      </FieldDescription>
    </Field>
  )
}

function StepFrame({
  children,
  description,
  title,
}: {
  children: React.ReactNode
  description: string
  title: string
}) {
  return (
    <section className="grid gap-4">
      <div className="grid gap-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  )
}

function summaryItems(wizard: NewProjectWizard) {
  const configuration = wizard.configuration
  return [
    { label: "Path", value: `${wizard.parentPath}/${wizard.projectName}` },
    {
      label: "Frontend",
      value: optionLabel(frontendOptions, configuration.frontend),
    },
    {
      label: "Styling",
      value: optionLabel(stylingOptions, configuration.styling),
    },
    {
      label: "UI library",
      value: optionLabel(
        uiLibraryOptions(configuration.frontend),
        configuration.uiLibrary
      ),
    },
    {
      label: "Backend",
      value: optionLabel(
        backendOptions(configuration.frontend),
        configuration.backend
      ),
    },
    {
      label: "Database",
      value: optionLabel(databaseOptions, configuration.database),
    },
    {
      label: "ORM",
      value: optionLabel(
        ormOptions(configuration.backend, configuration.database),
        configuration.orm
      ),
    },
    {
      label: "Package manager",
      value: optionLabel(
        packageManagerOptions(configuration.backend),
        configuration.packageManager
      ),
    },
    {
      label: "Code quality",
      value: optionLabel(
        codeQualityOptions(configuration.frontend, configuration.backend),
        configuration.codeQuality
      ),
    },
  ]
}

function stepLabel(step: NewProjectStep) {
  if (step === "location") return "Location"
  if (step === "platform") return "Platform"
  if (step === "frontend") return "Frontend"
  if (step === "styling") return "Styling"
  if (step === "backend") return "Backend"
  if (step === "data") return "Data"
  if (step === "quality") return "Quality"
  if (step === "advanced") return "Advanced"
  if (step === "progress") return "Progress"
  return "Summary"
}
