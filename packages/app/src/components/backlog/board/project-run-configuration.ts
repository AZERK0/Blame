import type { ProjectRunConfiguration } from "@blame/agent-runtime"

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
