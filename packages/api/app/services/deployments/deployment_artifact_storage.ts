import { workspaceArtifactObjectStorage } from '#services/workspace_artifacts/workspace_artifact_object_storage'

export function deploymentArtifactStorage() {
  return workspaceArtifactObjectStorage()
}

export function deploymentArtifactKey(deploymentId: string, artifactId: string) {
  return `deployments/${deploymentId}/${artifactId}.tar.gz`
}
