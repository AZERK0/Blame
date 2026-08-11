import assert from "node:assert/strict"
import test from "node:test"
import type { ProjectPreviewRuntimeState } from "@blame/agent-runtime"
import type { PreviewSessionView } from "@blame/preview-runtime"

import {
  managedPreviewActive,
  managedPreviewReady,
  managedPreviewRuntimeState,
} from "./managed-preview-runtime-state.ts"

const localRuntime = {
  configurations: [
    {
      id: "web",
      name: "Web",
      command: "pnpm dev",
      cwd: ".",
      services: ["web"],
      previewService: "web",
      previewUrl: "http://localhost:3000",
    },
  ],
  desiredStatus: "running",
  selectedConfigurationId: "web",
  statuses: { web: "starting" },
} satisfies ProjectPreviewRuntimeState

test("shows an auto-started managed configuration as starting", () => {
  const runtime = managedPreviewRuntimeState(
    session({ engine: "starting", preview: "opening" }),
    localRuntime
  )

  assert.equal(runtime.selectedConfigurationId, "web")
  assert.equal(runtime.statuses.web, "starting")
  assert.equal(runtime.previewUrl, undefined)
})

test("publishes the managed preview URL once the session is ready", () => {
  const value = session({ engine: "running", preview: "ready" })
  value.endpointMap = {
    revision: 1,
    primaryRouteId: "route",
    primaryPublicUrl: "https://preview.example.test",
    routes: [
      {
        basePathMode: "root",
        routeId: "route",
        serviceId: "web",
        endpointId: "http",
        externallyCompatible: true,
        logicalHost: "localhost",
        logicalPort: 3000,
        protocol: "http",
        publicUrl: "https://preview.example.test",
        sandboxPort: 41000,
        targetHost: "127.0.0.1",
        targetPort: 3000,
      },
    ],
    supportsWebSocket: true,
    integratedPreviewRequired: false,
    incompatibilityReasons: [],
  }
  const runtime = managedPreviewRuntimeState(value, localRuntime)

  assert.equal(runtime.statuses.web, "running")
  assert.equal(runtime.previewUrl, "https://preview.example.test")
  assert.equal(managedPreviewReady(value), true)
})

test("reports a failed managed start on the selected configuration", () => {
  const value = session({ engine: "failed", preview: "degraded" })
  const runtime = managedPreviewRuntimeState(value, localRuntime)

  assert.equal(runtime.statuses.web, "error")
  assert.equal(managedPreviewActive(value), false)
})

test("does not keep a managed preview active while it is stopping", () => {
  const value = session({ engine: "stopping", preview: "closing" })
  value.desired.services = "stopped"

  assert.equal(managedPreviewActive(value), false)
})

test("reports a running managed preview as active", () => {
  assert.equal(
    managedPreviewActive(session({ engine: "running", preview: "ready" })),
    true
  )
})

function session(
  state: Pick<PreviewSessionView["state"], "engine" | "preview">
) {
  return {
    id: "preview_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    userStoryId: "story",
    ownerUserId: "owner",
    profile: "vercel-compose",
    desired: {
      host: "active",
      services: "running",
      preview: "open",
      agent: "idle",
    },
    state: {
      host: "running",
      agent: "idle",
      sync: "clean",
      ...state,
    },
    selection: { configurationId: "web", serviceIds: ["web"] },
    revision: 1,
    generation: 1,
    planHash: "hash",
    planVersion: 1,
    resourceSize: { vcpus: 2, memoryGb: 4 },
    lastActivityAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  } satisfies PreviewSessionView
}
