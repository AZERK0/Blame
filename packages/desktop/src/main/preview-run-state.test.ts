import assert from "node:assert/strict";
import test from "node:test";
import type { PreviewManifest } from "@blame/agent-runtime";

import {
  initialPreviewRuntimeSelection,
  normalizeStoredRunConfigurations,
  previewRunConfigurationStatus,
  previewRunConfigurationServiceIds,
  selectedPreviewRuntimeServiceIds,
  selectedPreviewRunConfiguration,
  shouldStartBrowserPreview,
} from "./preview-run-state.ts";

const configurations = [
  {
    id: "marketing",
    name: "Marketing",
    command: "pnpm dev",
    cwd: "apps/marketing",
    default: true,
    services: ["marketing"],
  },
  {
    id: "app",
    name: "App",
    command: "pnpm dev",
    cwd: "apps/app",
    default: false,
    services: ["app"],
  },
];
const browserPreviewManifest = {
  services: [
    {
      id: "web",
      kind: "preview",
      preview: { internalPort: 3000, path: "/", protocol: "http" },
    },
  ],
} as PreviewManifest;

test("selects the story recommendation before the project default", () => {
  const state = initialPreviewRuntimeSelection(configurations, "app");
  assert.equal(
    selectedPreviewRunConfiguration(configurations, state)?.id,
    "app",
  );
});

test("reports a selected configuration as running from its target service", () => {
  const state = initialPreviewRuntimeSelection(configurations, "app");
  assert.equal(
    previewRunConfigurationStatus(
      configurations[1],
      [{ service: "app", status: "running" }],
      state,
    ),
    "running",
  );
});

test("treats an intentional clean stop as stopped", () => {
  assert.equal(
    previewRunConfigurationStatus(
      configurations[1],
      [{ exitCode: 0, service: "app", status: "exited" }],
      { desiredStatus: "stopped", selectedConfigurationId: "app" },
    ),
    "stopped",
  );
});

test("reports an unexpected clean exit from the selected service", () => {
  assert.equal(
    previewRunConfigurationStatus(
      configurations[1],
      [{ exitCode: 0, service: "app", status: "exited" }],
      { desiredStatus: "running", selectedConfigurationId: "app" },
    ),
    "error",
  );
});

test("reports unhealthy target services as errors", () => {
  assert.equal(
    previewRunConfigurationStatus(
      configurations[0],
      [{ health: "unhealthy", service: "marketing", status: "running" }],
      { desiredStatus: "running", selectedConfigurationId: "marketing" },
    ),
    "error",
  );
});

test("includes backend dependencies in a web run configuration", () => {
  const manifest = {
    services: [
      { id: "database", kind: "dependency" },
      { id: "backend", kind: "worker", dependsOn: ["database"] },
      {
        id: "app",
        kind: "preview",
        bindings: [
          {
            exposure: "server",
            source: { endpoint: "http", service: "backend" },
            target: { key: "API_URL", type: "environment" },
          },
        ],
      },
    ],
  } as PreviewManifest;
  assert.deepEqual(
    previewRunConfigurationServiceIds(configurations[1], manifest),
    ["app", "backend", "database"],
  );
});

test("repairs service configurations widened to the only web preview", () => {
  const manifest = {
    services: [
      { id: "backend", kind: "worker", workingDir: "/workspace/apps/backend" },
      {
        id: "web",
        kind: "preview",
        preview: { internalPort: 3000, path: "/", protocol: "http" },
      },
    ],
  } as PreviewManifest;
  const repaired = normalizeStoredRunConfigurations(
    [
      {
        ...configurations[1],
        category: "service",
        id: "backend",
        previewService: "web",
        scopes: ["apps/backend", "api"],
        services: ["web"],
      },
    ],
    manifest,
  );
  assert.deepEqual(repaired[0]?.services, ["backend"]);
  assert.equal(repaired[0]?.previewService, undefined);
});

test("keeps legacy unclassified web configurations compatible", () => {
  const configuration = {
    ...configurations[1],
    previewService: "app",
    services: ["app"],
  };
  const manifest = {
    services: [{ id: "app", kind: "preview" }],
  } as PreviewManifest;
  assert.deepEqual(
    normalizeStoredRunConfigurations([configuration], manifest),
    [configuration],
  );
});

test("does not start a browser for a manifest without a preview service", () => {
  const manifest = {
    services: [{ id: "worker", kind: "worker" }],
  } as PreviewManifest;
  assert.equal(
    shouldStartBrowserPreview([], { desiredStatus: "running" }, manifest),
    false,
  );
});

test("does not start a browser for selected service or terminal runs", () => {
  for (const category of ["service", "terminal"] as const) {
    const configuration = {
      ...configurations[0],
      category,
      previewService: "web",
      services: ["web"],
    };
    assert.equal(
      shouldStartBrowserPreview(
        [configuration],
        initialPreviewRuntimeSelection([configuration], undefined),
        browserPreviewManifest,
      ),
      false,
    );
  }
});

test("starts a browser for the selected web preview", () => {
  const configuration = {
    ...configurations[0],
    category: "web" as const,
    previewService: "web",
    services: ["web"],
  };
  assert.equal(
    shouldStartBrowserPreview(
      [configuration],
      initialPreviewRuntimeSelection([configuration], undefined),
      browserPreviewManifest,
    ),
    true,
  );
});

test("starts a browser from a web manifest without stored configurations", () => {
  assert.equal(
    shouldStartBrowserPreview(
      [],
      { desiredStatus: "running" },
      browserPreviewManifest,
    ),
    true,
  );
});

test("keeps manifest-less preview discovery compatible", () => {
  assert.equal(
    shouldStartBrowserPreview([], { desiredStatus: "running" }, undefined),
    true,
  );
  assert.equal(
    shouldStartBrowserPreview(
      configurations,
      initialPreviewRuntimeSelection(configurations, undefined),
      undefined,
    ),
    false,
  );
  const legacyPreview = { ...configurations[0], previewService: "marketing" };
  assert.equal(
    shouldStartBrowserPreview(
      [legacyPreview],
      initialPreviewRuntimeSelection([legacyPreview], undefined),
      undefined,
    ),
    true,
  );
});

test("returns no compose targets when setup has no runtime services", () => {
  assert.deepEqual(
    selectedPreviewRuntimeServiceIds(
      configurations,
      initialPreviewRuntimeSelection(configurations, undefined),
      [],
    ),
    [],
  );
});

test("does not start unrelated compose services for a host-only desktop configuration", () => {
  const desktopConfiguration = {
    id: "desktop",
    name: "Desktop development",
    command: "pnpm dev",
    cwd: ".",
    default: true,
    category: "desktop" as const,
    services: [],
    scopes: ["desktop", "backend"],
  };
  const state = initialPreviewRuntimeSelection(
    [desktopConfiguration],
    undefined,
  );

  assert.deepEqual(
    selectedPreviewRuntimeServiceIds([desktopConfiguration], state, [
      "vitrine",
      "api",
    ]),
    [],
  );
  assert.equal(
    previewRunConfigurationStatus(desktopConfiguration, [], state),
    "stopped",
  );
});

test("selects configured runtime services and preserves the legacy fallback", () => {
  const state = initialPreviewRuntimeSelection(configurations, "app");
  assert.deepEqual(
    selectedPreviewRuntimeServiceIds(configurations, state, [
      "marketing",
      "app",
    ]),
    ["app"],
  );
  assert.deepEqual(
    selectedPreviewRuntimeServiceIds([], state, ["marketing", "app"]),
    ["marketing", "app"],
  );
});
