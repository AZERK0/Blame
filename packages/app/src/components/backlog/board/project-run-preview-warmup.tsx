import type { ProjectRunConfiguration } from "@blame/agent-runtime"

import {
  projectRunConfigurationPreviewKey,
  projectRunConfigurationPreviewUrl,
} from "@/components/backlog/board/project-run-configuration"
import { PreviewUrlWarmup } from "@/components/backlog/drawer/user-story-preview"

export function ProjectRunConfigurationPreviewWarmup({
  configuration,
  devtoolsTarget,
  enabled = true,
  scope,
  trigger,
}: {
  configuration?: ProjectRunConfiguration
  devtoolsTarget?: boolean
  enabled?: boolean
  scope?: string
  trigger?: number | string
}) {
  const previewUrl = projectRunConfigurationPreviewUrl(configuration)
  if (!enabled || !configuration || !previewUrl) return null
  return (
    <PreviewUrlWarmup
      devtoolsTarget={devtoolsTarget}
      previewKey={projectRunConfigurationPreviewKey(configuration, scope)}
      previewUrl={previewUrl}
      trigger={trigger}
    />
  )
}
