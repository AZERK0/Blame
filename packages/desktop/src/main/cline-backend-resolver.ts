import type { AgentBackendConfig } from "@blame/agent-runtime"
import { setupPath } from "./host-tool-path.ts"
import { runtimeAgentClient } from "./runtime-agent.ts"
import { ensureRuntimeReady } from "./runtime-manager.ts"
import {
  runtimeHostPath,
  runtimeManagedPath,
} from "./workspace-runtime.ts"

export type AgentWorkspaceResolution = {
  backend: AgentBackendConfig
  input: Record<string, unknown>
}

type ResolverInput = {
  agentClient?: {
    clineHubEnsure(): Promise<{ authToken?: string; url?: string }>
  }
  env?: NodeJS.ProcessEnv
  ensureReady?: typeof ensureRuntimeReady
  platform?: NodeJS.Platform
}

const runtimeBackendMessage =
  "Cline runtime backend unavailable in BlameRuntime. Repair or reset the Blame runtime and try again."

export async function resolveAgentWorkspaceInput<T extends Record<string, unknown>>(
  input: T,
  options: ResolverInput = {},
) {
  const platform = options.platform ?? process.platform
  const runtimeField = runtimeManagedWorkspaceField(input, platform)
  if (!runtimeField) return localWorkspaceInput(input, platform)
  await (options.ensureReady ?? ensureRuntimeReady)(
    runtimeEnvironment(options, platform)
  )
  const hub = await ensureRuntimeClineHub(options, platform)
  return {
    ...runtimeNativeWorkspaceInput(input),
    backend: {
      mode: "remote",
      endpoint: hub.url,
      authToken: hub.authToken,
      cwd: stringField(input.cwd),
      workspaceRoot: stringField(input.workspaceRoot),
      key: `runtime:${platform}:${hub.url}`,
    },
  }
}

export function localWorkspaceInput<T extends Record<string, unknown>>(
  input: T,
  platform: NodeJS.Platform = process.platform,
) {
  return {
    ...input,
    ...(typeof input.cwd === "string"
      ? { cwd: runtimeHostPath(input.cwd, platform) }
      : {}),
    ...(typeof input.workspaceRoot === "string"
      ? { workspaceRoot: runtimeHostPath(input.workspaceRoot, platform) }
      : {}),
    ...(typeof input.worktree === "string"
      ? { worktree: runtimeHostPath(input.worktree, platform) }
      : {}),
    ...(typeof input.repositoryRoot === "string"
      ? { repositoryRoot: runtimeHostPath(input.repositoryRoot, platform) }
      : {}),
    backend: { mode: "local", key: "local" },
  }
}

function runtimeNativeWorkspaceInput<T extends Record<string, unknown>>(
  input: T,
) {
  return {
    ...input,
    ...(typeof input.cwd === "string" ? { cwd: input.cwd } : {}),
    ...(typeof input.workspaceRoot === "string"
      ? { workspaceRoot: input.workspaceRoot }
      : {}),
    ...(typeof input.worktree === "string" ? { worktree: input.worktree } : {}),
    ...(typeof input.repositoryRoot === "string"
      ? { repositoryRoot: input.repositoryRoot }
      : {}),
  }
}

function runtimeManagedWorkspaceField(
  input: Record<string, unknown>,
  platform: NodeJS.Platform,
) {
  return ["cwd", "workspaceRoot", "worktree", "repositoryRoot"].find((key) => {
    const value = input[key]
    return typeof value === "string" && runtimeManagedPath(value, platform)
  })
}

async function ensureRuntimeClineHub(
  options: ResolverInput,
  platform: NodeJS.Platform,
) {
  try {
    const client =
      options.agentClient ??
      runtimeAgentClient({
        env: runtimeEnvironment(options, platform).env,
        platform,
      })
    const hub = await client.clineHubEnsure()
    if (!hub.url) throw new Error("Runtime Cline hub did not return a URL.")
    return hub
  } catch (error) {
    throw runtimeBackendUnavailable(error)
  }
}

function runtimeEnvironment(
  options: ResolverInput,
  platform: NodeJS.Platform,
) {
  return {
    env: options.env ?? {
      ...process.env,
      PATH: setupPath({ platform }),
    },
    platform,
  }
}

function runtimeBackendUnavailable(error: unknown) {
  const next = new Error(`${runtimeBackendMessage}\n${errorMessage(error)}`)
  Object.assign(next, { cause: error })
  return next
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function stringField(value: unknown) {
  return typeof value === "string" ? value : undefined
}
