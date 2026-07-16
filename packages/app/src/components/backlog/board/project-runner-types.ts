import type { ProjectRunConfigurationStatus } from "@blame/agent-runtime"

export type ProjectRunnerControlStatus =
  | ProjectRunConfigurationStatus
  | "stopping"

export type ProjectRunnerPendingOperation = {
  action: "start" | "stop" | "restart"
  configurationId: string
}
