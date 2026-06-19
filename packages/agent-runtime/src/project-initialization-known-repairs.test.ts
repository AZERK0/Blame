import assert from "node:assert/strict"
import test from "node:test"

import { repairKnownProjectInitializationFailure } from "./project-initialization-known-repairs.js"
import type {
  PreviewManifest,
  ProjectInitializationDiagnostics,
} from "./types.js"

const diagnostics: ProjectInitializationDiagnostics = {
  setupLog: "",
  launchError: "Preview container stopped before responding",
  composeConfig: "",
  composePs: "",
  serviceLogs: {
    web: [
      "Error: Turbopack build failed with 1 errors:",
      "Error: Next.js inferred your workspace root, but it may not be correct.",
      "We couldn't find the Next.js package (next/package.json) from the project directory: /workspace/apps/web/app",
      "To fix this, set turbopack.root in your Next.js config",
    ].join("\n"),
  },
}

const manifest: PreviewManifest = {
  version: 1,
  confidence: "high",
  project: { root: ".", detectedStack: ["node", "nextjs"], confidence: "high" },
  setup: [
    {
      id: "deps",
      image: "node:22-bookworm",
      workingDir: "/workspace",
      command:
        "corepack prepare pnpm@10.33.2 --activate && corepack pnpm install",
    },
  ],
  services: [
    {
      id: "web",
      kind: "preview",
      image: "node:22-bookworm",
      workingDir: "/workspace",
      command:
        "corepack prepare pnpm@10.33.2 --activate && corepack pnpm dev",
      preview: { internalPort: 3000, protocol: "http", path: "/" },
      healthcheck: { type: "http", path: "/", timeoutMs: 30_000 },
    },
  ],
  caches: [],
  risks: [],
}

test("repairs Next Turbopack root failures by forwarding webpack to pnpm dev", () => {
  const result = repairKnownProjectInitializationFailure({
    diagnostics,
    previewManifest: manifest,
    setupScript: "#!/usr/bin/env bash\n",
    dockerCompose: "",
    runConfigurations: [
      {
        id: "web",
        name: "Web application",
        command: "pnpm dev",
        cwd: ".",
        default: true,
      },
    ],
  })

  assert.equal(result?.classification, "repairable_initialization")
  assert.match(
    result?.previewManifest?.services[0]?.command ?? "",
    /corepack pnpm dev --webpack/,
  )
  assert.match(result?.dockerCompose ?? "", /corepack pnpm dev --webpack/)
  assert.equal(result?.runConfigurations?.[0]?.command, "pnpm dev --webpack")
})

test("repairs direct Next dev commands without changing explicit bundler choices", () => {
  const result = repairKnownProjectInitializationFailure({
    diagnostics,
    previewManifest: {
      ...manifest,
      services: [
        {
          ...manifest.services[0]!,
          command: "next dev",
        },
        {
          id: "worker",
          kind: "worker",
          image: "node:22-bookworm",
          workingDir: "/workspace",
          command: "next dev",
        },
      ],
    },
    setupScript: "#!/usr/bin/env bash\n",
    dockerCompose: "",
    runConfigurations: [
      {
        id: "web",
        name: "Web application",
        command: "next dev --turbopack",
        cwd: ".",
        default: true,
      },
    ],
  })

  assert.equal(
    result?.previewManifest?.services[0]?.command,
    "next dev --webpack",
  )
  assert.equal(result?.previewManifest?.services[1]?.command, "next dev")
  assert.equal(result?.runConfigurations?.[0]?.command, "next dev --turbopack")
})

test("repairs legacy compose commands when no preview manifest is available", () => {
  const result = repairKnownProjectInitializationFailure({
    diagnostics,
    setupScript: "#!/usr/bin/env bash\n",
    dockerCompose: [
      "services:",
      "  web:",
      "    image: node:22-bookworm",
      '    command: "sh -lc \'corepack pnpm dev\'"',
      "    ports:",
      '      - "127.0.0.1::3000"',
    ].join("\n"),
    runConfigurations: [],
  })

  assert.match(result?.dockerCompose ?? "", /corepack pnpm dev --webpack/)
})

test("ignores unrelated initialization failures", () => {
  const result = repairKnownProjectInitializationFailure({
    diagnostics: {
      ...diagnostics,
      serviceLogs: { web: "ReferenceError: window is not defined" },
    },
    previewManifest: manifest,
    setupScript: "#!/usr/bin/env bash\n",
    dockerCompose: "",
    runConfigurations: [],
  })

  assert.equal(result, null)
})
