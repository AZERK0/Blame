import {
  FolderOpenIcon,
  GitBranchPlusIcon,
  LoaderCircleIcon,
  PlusIcon,
} from "lucide-react"
import type * as React from "react"

import { Button } from "@/components/ui/button"
import { useProjects } from "@/context/projects"

export function WelcomeScreen() {
  const projects = useProjects()

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <section className="grid w-full max-w-3xl gap-12 text-center">
        <div className="grid gap-3">
          <h1 className="font-heading text-3xl font-semibold">
            Welcome to Blame
          </h1>
          <div className="grid gap-1 text-sm text-muted-foreground">
            <p>Create a new project to start from scratch.</p>
            <p>Open existing project from disk or version control.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-7 sm:grid-cols-3">
          <WelcomeAction
            disabled
            icon={<PlusIcon className="size-6" />}
            label="New Project"
          />
          <WelcomeAction
            active
            disabled={projects.opening}
            icon={
              projects.opening ? (
                <LoaderCircleIcon className="size-6 animate-spin" />
              ) : (
                <FolderOpenIcon className="size-6" />
              )
            }
            label={projects.opening ? "Opening" : "Open"}
            onClick={() => void projects.chooseProject()}
          />
          <WelcomeAction
            disabled
            icon={<GitBranchPlusIcon className="size-6" />}
            label="Clone Repository"
          />
        </div>
      </section>
    </main>
  )
}

function WelcomeAction({
  active,
  disabled,
  icon,
  label,
  onClick,
}: {
  active?: boolean
  disabled?: boolean
  icon: React.ReactNode
  label: string
  onClick?(): void
}) {
  return (
    <div className="grid justify-items-center gap-3">
      <Button
        size="icon-lg"
        variant={active ? "outline" : "secondary"}
        disabled={disabled}
        className="size-14 rounded-md"
        onClick={onClick}
      >
        {icon}
        <span className="sr-only">{label}</span>
      </Button>
      <span className="text-sm font-medium">{label}</span>
    </div>
  )
}
