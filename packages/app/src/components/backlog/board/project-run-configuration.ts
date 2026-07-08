import type { ProjectRunConfiguration } from "@blame/agent-runtime"

import { runnerPreviewDevtoolsScope } from "@/components/backlog/shared/preview-devtools-scope"

export function projectRunConfigurationPreviewUrl(
  configuration?: ProjectRunConfiguration
) {
  const previewUrl = configuration?.previewUrl?.trim()
  return previewUrl || undefined
}

export function projectPreviewConfiguration(
  configurations: ProjectRunConfiguration[]
) {
  return (
    configurations.find(
      (configuration) =>
        configuration.default &&
        projectRunConfigurationPreviewUrl(configuration)
    ) ?? configurations.find(projectRunConfigurationPreviewUrl)
  )
}

export function projectRunConfigurationPreviewKey(
  configuration?: ProjectRunConfiguration,
  scope = "project"
) {
  return runnerPreviewDevtoolsScope(configuration, scope)
}
