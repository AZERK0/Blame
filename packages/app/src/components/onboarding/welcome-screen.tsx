import {
  ClockIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GitBranchPlusIcon,
  LoaderCircleIcon,
  PlusIcon,
  XIcon,
} from "lucide-react"
import * as React from "react"

import { NewProjectDialog } from "@/components/new-project/new-project-dialog"
import { Button } from "@/components/ui/button"
import { useProjects } from "@/context/projects"
import type { Project } from "@/lib/projects"

export function WelcomeScreen() {
  const projects = useProjects()
  const [newProjectOpen, setNewProjectOpen] = React.useState(false)

  function openRecentProject(path: string) {
    void projects.openProject(path)
  }

  return (
    <>
      <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground">
        <section className="grid w-full max-w-3xl gap-7">
          <WelcomeHeader />
          <WelcomeActions
            opening={projects.opening}
            onNewProject={() => setNewProjectOpen(true)}
            onOpenProject={() => void projects.chooseProject()}
          />
          <RecentProjects
            projects={projects.recentProjects}
            opening={projects.opening}
            onOpen={openRecentProject}
            onRemove={projects.removeRecentProject}
          />
        </section>
      </main>
      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
      />
    </>
  )
}

function WelcomeHeader() {
  return (
    <header className="grid gap-2 text-center">
      <div className="grid gap-2">
        <h1 className="font-heading text-4xl font-semibold">
          Welcome to Blame
        </h1>
        <p className="mx-auto max-w-lg text-sm text-foreground/65">
          Open a workspace, start from a clean project, or jump back into recent
          work.
        </p>
      </div>
    </header>
  )
}

function WelcomeActions({
  opening,
  onNewProject,
  onOpenProject,
}: {
  opening: boolean
  onNewProject(): void
  onOpenProject(): void
}) {
  return (
    <div className="grid gap-2 md:grid-cols-3">
      <WelcomeAction
        icon={<PlusIcon />}
        label="New Project"
        description="Start fresh."
        onClick={onNewProject}
      />
      <WelcomeAction
        active
        disabled={opening}
        icon={
          opening ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : (
            <FolderOpenIcon />
          )
        }
        label={opening ? "Opening" : "Open Project"}
        description="Choose a folder."
        onClick={onOpenProject}
      />
      <WelcomeAction
        disabled
        icon={<GitBranchPlusIcon />}
        label="Clone Repository"
        description="Coming soon."
      />
    </div>
  )
}

function WelcomeAction({
  active,
  description,
  disabled,
  icon,
  label,
  onClick,
}: {
  active?: boolean
  description: string
  disabled?: boolean
  icon: React.ReactNode
  label: string
  onClick?(): void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`group flex items-center gap-3 rounded-lg border bg-background/45 p-3 text-left transition hover:bg-background/70 disabled:pointer-events-none disabled:opacity-50 ${
        active ? "border-primary/40" : "border-border/70"
      }`}
      onClick={onClick}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground transition group-hover:bg-primary group-hover:text-primary-foreground [&_svg]:size-4">
        {icon}
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="truncate text-sm font-medium">{label}</span>
        <span className="truncate text-xs text-foreground/60">
          {description}
        </span>
      </span>
    </button>
  )
}

function RecentProjects({
  onOpen,
  onRemove,
  opening,
  projects,
}: {
  onOpen(path: string): void
  onRemove(path: string): void
  opening: boolean
  projects: Project[]
}) {
  return (
    <section className="px-4">
      <SectionTitle
        icon={<ClockIcon />}
        title="Recent projects"
        description="Continue where you left off."
      />
      {projects.length > 0 ? (
        <div className="mt-4 grid gap-2">
          {projects.slice(0, 6).map((project) => (
            <RecentProject
              key={project.path}
              project={project}
              disabled={opening}
              onOpen={onOpen}
              onRemove={onRemove}
            />
          ))}
        </div>
      ) : (
        <EmptyRecentProjects />
      )}
    </section>
  )
}

function RecentProject({
  disabled,
  onOpen,
  onRemove,
  project,
}: {
  disabled: boolean
  onOpen(path: string): void
  onRemove(path: string): void
  project: Project
}) {
  return (
    <div className="group flex min-w-0 items-center gap-1 rounded-md transition hover:bg-muted">
      <button
        type="button"
        disabled={disabled}
        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left disabled:pointer-events-none disabled:opacity-50"
        onClick={() => onOpen(project.path)}
      >
        <ProjectMark project={project} />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate text-sm font-medium">{project.name}</span>
          <span className="truncate text-xs text-foreground/60">
            {project.path}
          </span>
          <ProjectBranch branch={project.branch} />
        </span>
      </button>
      <RemoveRecentProject project={project} onRemove={onRemove} />
    </div>
  )
}

function RemoveRecentProject({
  onRemove,
  project,
}: {
  onRemove(path: string): void
  project: Project
}) {
  function removeProject(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    onRemove(project.path)
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={`Remove ${project.name} from recent projects`}
      className="opacity-0 group-hover:opacity-100"
      onClick={removeProject}
    >
      <XIcon />
    </Button>
  )
}

function EmptyRecentProjects() {
  return (
    <div className="mt-4 rounded-md bg-muted/20 p-4 text-sm text-foreground/60">
      No recent projects yet. Open a folder or create a new project to pin it
      here.
    </div>
  )
}

function SectionTitle({
  description,
  icon,
  title,
}: {
  description: string
  icon: React.ReactNode
  title: string
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 text-foreground/70 [&_svg]:size-4">{icon}</span>
      <span className="grid gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-sm text-foreground/65">{description}</span>
      </span>
    </div>
  )
}

function ProjectBranch({ branch }: { branch?: string }) {
  if (!branch) return null

  return (
    <span className="flex items-center gap-1 text-xs text-foreground/60">
      <GitBranchIcon className="size-3" />
      <span className="truncate">{branch}</span>
    </span>
  )
}

function ProjectMark({ project }: { project: Project }) {
  return (
    <span
      className={`${project.color} flex size-9 shrink-0 items-center justify-center rounded-md text-sm font-medium text-white`}
    >
      {project.initials}
    </span>
  )
}
