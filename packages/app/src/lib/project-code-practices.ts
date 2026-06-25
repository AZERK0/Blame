import type { useCloudAuth } from "@/context/cloud-auth"
import type { useProjects } from "@/context/projects"
import { createCloudApi } from "@/lib/cloud-api"

export function projectCodePractices(
  auth: ReturnType<typeof useCloudAuth>,
  projects: ReturnType<typeof useProjects>
) {
  if (!projects.activeProject) return Promise.resolve([])
  return createCloudApi(auth.apiConnection)
    .projectInitialization(projects.activeProject.id)
    .then((snapshot) => snapshot.practices)
}
