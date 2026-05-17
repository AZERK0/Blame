import * as React from "react"

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { SidebarMenuButton } from "@/components/ui/sidebar"
import { useProjects } from "@/context/projects"
import type { Project } from "@/lib/projects"
import {
  ChevronDownIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GitBranchPlusIcon,
  PlusIcon,
} from "lucide-react"

export function ProjectSelector() {
  const projects = useProjects()
  const [open, setOpen] = React.useState(false)

  async function openProject() {
    await projects.chooseProject()
    setOpen(false)
  }

  function selectProject(path: string) {
    void projects.openProject(path)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <SidebarMenuButton
          className="h-9 justify-between px-1.5 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          tooltip={projects.activeProject?.name ?? "Open Project"}
        >
          <ProjectTrigger project={projects.activeProject} />
          <ChevronDownIcon className="ml-auto size-4 text-muted-foreground" />
        </SidebarMenuButton>
      </PopoverTrigger>
      <ProjectSelectorContent
        activeProject={projects.activeProject}
        recentProjects={projects.recentProjects}
        opening={projects.opening}
        onOpenProject={openProject}
        onSelectProject={selectProject}
      />
    </Popover>
  )
}

function ProjectTrigger({ project }: { project?: Project }) {
  if (!project) {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <FolderOpenIcon className="size-5" />
        <span className="truncate font-medium">Open Project</span>
      </span>
    )
  }

  return (
    <span className="flex min-w-0 items-center gap-2">
      <ProjectMark project={project} />
      <span className="truncate font-medium">{project.name}</span>
    </span>
  )
}

function ProjectSelectorContent({
  activeProject,
  recentProjects,
  opening,
  onOpenProject,
  onSelectProject,
}: {
  activeProject?: Project
  recentProjects: Project[]
  opening: boolean
  onOpenProject: () => Promise<void>
  onSelectProject: (path: string) => void
}) {
  return (
    <PopoverContent align="start" className="w-80 p-1">
      <Command>
        <CommandList>
          <ProjectActions opening={opening} onOpenProject={onOpenProject} />
          {activeProject && (
            <>
              <CommandSeparator />
              <ProjectGroup
                heading="Open Project"
                projects={[activeProject]}
                selectedPath={activeProject.path}
                onSelect={onSelectProject}
              />
            </>
          )}
          <RecentProjects
            activeProject={activeProject}
            recentProjects={recentProjects}
            onSelect={onSelectProject}
          />
        </CommandList>
      </Command>
    </PopoverContent>
  )
}

function ProjectActions({
  opening,
  onOpenProject,
}: {
  opening: boolean
  onOpenProject: () => Promise<void>
}) {
  return (
    <CommandGroup>
      <CommandItem>
        <PlusIcon />
        <span>New Project...</span>
      </CommandItem>
      <CommandItem disabled={opening} onSelect={() => void onOpenProject()}>
        <FolderOpenIcon />
        <span>{opening ? "Opening Project..." : "Open Project..."}</span>
      </CommandItem>
      <CommandItem>
        <GitBranchPlusIcon />
        <span>Clone Repository...</span>
      </CommandItem>
    </CommandGroup>
  )
}

function RecentProjects({
  activeProject,
  recentProjects,
  onSelect,
}: {
  activeProject?: Project
  recentProjects: Project[]
  onSelect: (path: string) => void
}) {
  if (recentProjects.length === 0) {
    if (activeProject) return null
    return <CommandEmpty>No project opened yet</CommandEmpty>
  }

  return (
    <>
      <CommandSeparator />
      <ProjectGroup
        heading="Recent Projects"
        projects={recentProjects}
        selectedPath={activeProject?.path}
        onSelect={onSelect}
      />
    </>
  )
}

function ProjectGroup({
  heading,
  projects,
  selectedPath,
  onSelect,
}: {
  heading: string
  projects: Project[]
  selectedPath?: string
  onSelect: (path: string) => void
}) {
  return (
    <CommandGroup heading={heading}>
      {projects.map((project) => (
        <ProjectItem
          key={project.path}
          project={project}
          selected={selectedPath === project.path}
          onSelect={onSelect}
        />
      ))}
    </CommandGroup>
  )
}

function ProjectItem({
  project,
  selected,
  onSelect,
}: {
  project: Project
  selected: boolean
  onSelect: (path: string) => void
}) {
  return (
    <CommandItem
      value={project.path}
      data-checked={selected}
      onSelect={() => onSelect(project.path)}
      className="items-start gap-2"
    >
      <ProjectMark project={project} />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate font-medium">{project.name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {project.path}
        </span>
        <ProjectBranch branch={project.branch} />
      </span>
    </CommandItem>
  )
}

function ProjectBranch({ branch }: { branch?: string }) {
  if (!branch) return null

  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <GitBranchIcon className="size-3" />
      <span className="truncate">{branch}</span>
    </span>
  )
}

function ProjectMark({ project }: { project: Project }) {
  return (
    <span
      className={`${project.color} flex size-5 shrink-0 items-center justify-center rounded-sm text-xs font-medium text-white`}
    >
      {project.initials}
    </span>
  )
}
