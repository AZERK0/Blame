import assert from "node:assert/strict";
import test from "node:test";

import {
  parseProjectInitializationPayload,
  parseProjectInitializationResult,
  validateProjectInitializationArtifacts,
} from "./project-initialization.js";
import { parsePreviewManifest } from "./preview-manifest.js";

const baseResult = {
  setupScript: "set -euo pipefail",
  dockerCompose: [
    "services:",
    "  web:",
    "    image: node:22",
    "    ports:",
    '      - "127.0.0.1::3000"',
  ].join("\n"),
  runConfigurations: [
    {
      id: "web",
      name: "Web application",
      command: "pnpm dev",
      cwd: ".",
      default: true,
    },
  ],
  practices: [
    { practice: "coding_style", detected: false, comment: "Not detected." },
    { practice: "unit_tests", detected: false, comment: "Not detected." },
    {
      practice: "layered_architecture",
      detected: false,
      comment: "Not detected.",
    },
    {
      practice: "commit_message_convention",
      detected: false,
      comment: "Not detected.",
    },
  ],
};

const manifestResult = {
  previewManifest: {
    version: 1,
    confidence: "high",
    project: {
      root: ".",
      detectedStack: ["nuxt", "node", "pnpm"],
      confidence: "high",
    },
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
        preview: {
          internalPort: 3000,
          protocol: "http",
          path: "/",
        },
        healthcheck: {
          type: "http",
          path: "/",
          timeoutMs: 30_000,
        },
      },
    ],
    caches: [],
    risks: [],
  },
  runConfigurations: [
    {
      ...baseResult.runConfigurations[0],
      category: "web",
      services: ["web"],
      previewService: "web",
      scopes: ["frontend", "apps/web"],
    },
  ],
  practices: baseResult.practices,
};

test("parses project run configurations", () => {
  const result = parseProjectInitializationResult(JSON.stringify(baseResult));

  assert.deepEqual(result.runConfigurations, baseResult.runConfigurations);
});

test("parses run configuration preview urls", () => {
  const result = parseProjectInitializationResult(
    JSON.stringify({
      ...baseResult,
      runConfigurations: [
        {
          ...baseResult.runConfigurations[0],
          previewUrl: "http://localhost:5173/",
        },
      ],
    }),
  );

  assert.equal(
    result.runConfigurations[0]?.previewUrl,
    "http://localhost:5173/",
  );
});

test("rejects invalid run configuration preview urls", () => {
  assert.throws(
    () =>
      parseProjectInitializationResult(
        JSON.stringify({
          ...baseResult,
          runConfigurations: [
            {
              ...baseResult.runConfigurations[0],
              previewUrl: "http://localhost:5173/\nnext",
            },
          ],
        }),
      ),
    /previewUrl is invalid/,
  );
});

test("generates initialization artifacts from preview manifest", () => {
  const result = parseProjectInitializationResult(
    JSON.stringify(manifestResult),
  );

  assert.equal(result.previewManifest?.services[0]?.kind, "preview");
  assert.match(result.setupScript, /COMPOSE_PROJECT_NAME/);
  assert.match(result.dockerCompose, /blame\.setup: "true"/);
  assert.match(result.dockerCompose, /blame\.preview: "true"/);
  assert.match(result.dockerCompose, /"127\.0\.0\.1::3000"/);
  assert.match(result.dockerCompose, /healthcheck:/);
  assert.match(
    result.dockerCompose,
    /blame_node_modules:\/workspace\/node_modules/,
  );
  assert.doesNotMatch(result.dockerCompose, /user: "\$\{BLAME_HOST_UID\}/);
  assert.match(
    result.dockerCompose,
    /blame-volumes-init:\n\s+condition: service_completed_successfully/,
  );
  assert.doesNotMatch(result.dockerCompose, /3000:3000/);
  assert.doesNotMatch(result.dockerCompose, /blame-volumes-init:\n\s+volumes:/);
});

test("supports libraries without runtime or browser services", () => {
  const result = parseProjectInitializationResult(
    JSON.stringify(nonBrowserInitialization([], [])),
  );

  assert.equal(result.runConfigurations.length, 0);
  assert.match(result.dockerCompose, /^services: \{\}/m);
  assert.match(result.dockerCompose, /^volumes: \{\}/m);
  assert.doesNotMatch(result.dockerCompose, /127\.0\.0\.1::/);
});

test("supports persistent workers without browser ports", () => {
  const result = parseProjectInitializationResult(
    JSON.stringify(nonBrowserInitialization([workerService()], [workerRun()])),
  );

  assert.match(result.dockerCompose, /blame\.service\.kind: "worker"/);
  assert.doesNotMatch(result.dockerCompose, /127\.0\.0\.1::/);
});

test("keeps runtime ports mandatory for browser and legacy manifests", () => {
  const compose = "services:\n  web:\n    image: node:22-bookworm";
  const manifest = parsePreviewManifest(manifestResult.previewManifest);

  assert.throws(
    () =>
      validateProjectInitializationArtifacts(
        "set -euo pipefail",
        compose,
        undefined,
        manifest,
      ),
    /runtime-allocated host ports/,
  );
  assert.throws(
    () => validateProjectInitializationArtifacts("set -euo pipefail", compose),
    /runtime-allocated host ports/,
  );
});

test("scopes validation evidence to the selected project root", () => {
  const manifest = parsePreviewManifest(scopedWorkerManifest());

  assert.doesNotThrow(() =>
    validateProjectInitializationArtifacts(
      "set -euo pipefail",
      scopedWorkerCompose(),
      unrelatedProjectScan,
      manifest,
    ),
  );
});

function nonBrowserInitialization(
  services: unknown[],
  runConfigurations: unknown[],
) {
  return {
    ...manifestResult,
    previewManifest: {
      ...manifestResult.previewManifest,
      project: { root: ".", detectedStack: ["python"] },
      setup: [],
      services,
      caches: [],
      probes: [],
    },
    runConfigurations,
  };
}

function workerService() {
  return {
    id: "worker",
    kind: "worker",
    image: "python:3.13-slim",
    workingDir: "/workspace",
    command: "python worker.py",
    endpoints: [],
  };
}

function workerRun() {
  return {
    id: "worker",
    name: "Worker",
    command: "python worker.py",
    cwd: ".",
    default: true,
    category: "service",
    services: ["worker"],
    scopes: ["worker"],
  };
}

function scopedWorkerManifest() {
  const initialization = nonBrowserInitialization(
    [
      {
        ...workerService(),
        image: "node:22-bookworm",
        workingDir: "/workspace/selected",
        command: "node worker.js",
      },
      {
        id: "database",
        kind: "dependency",
        image: "postgres:17",
        endpoints: [],
      },
    ],
    [],
  );
  return {
    ...initialization.previewManifest,
    project: { root: "selected" },
  };
}

function scopedWorkerCompose() {
  return [
    "services:",
    "  worker:",
    "    image: node:22-bookworm",
    "  database:",
    "    image: postgres:17",
  ].join("\n");
}

const unrelatedProjectScan = {
  rootName: "parent",
  topLevelEntries: [],
  files: {
    "unrelated/package.json": '{"dependencies":{"nuxt":"latest"}}',
    "unrelated/migrations/": "001_create_users.sql",
  },
  gitLog: [],
};

test("compiles version two service and browser bindings", () => {
  const web = {
    ...manifestResult.previewManifest.services[0],
    endpoints: [{ id: "http", protocol: "http", port: 3000 }],
    bindings: [
      {
        target: { type: "environment", key: "SERVER_API_URL" },
        source: { service: "backend", endpoint: "http" },
        exposure: "server",
      },
      {
        target: { type: "environment", key: "PUBLIC_APP_URL" },
        source: { service: "web", endpoint: "http" },
        exposure: "browser",
        path: "/app",
      },
      {
        target: { type: "environment", key: "PUBLIC_API_URL" },
        source: { service: "backend", endpoint: "http" },
        exposure: "browser",
        path: "/api",
      },
    ],
  };
  const result = parseProjectInitializationPayload({
    ...manifestResult,
    previewManifest: {
      ...manifestResult.previewManifest,
      version: 2,
      services: [
        {
          id: "backend",
          kind: "worker",
          image: "node:22-bookworm",
          command: "node server.js",
          endpoints: [
            {
              id: "http",
              protocol: "http",
              port: 3333,
              healthcheck: { type: "tcp", timeoutMs: 30_000 },
            },
          ],
        },
        web,
      ],
      probes: [
        {
          id: "api-proxy",
          from: "host",
          target: { service: "web", endpoint: "http", path: "/api/health" },
          type: "http",
        },
      ],
    },
  });

  assert.match(result.dockerCompose, /SERVER_API_URL: "http:\/\/backend:3333"/);
  assert.match(
    result.dockerCompose,
    /PUBLIC_APP_URL: "http:\/\/localhost:__BLAME_PREVIEW_PORT_web_3000__\/app"/,
  );
  assert.match(
    result.dockerCompose,
    /PUBLIC_API_URL: "http:\/\/localhost:__BLAME_PREVIEW_PORT_backend_3333__\/api"/,
  );
  assert.match(result.dockerCompose, /backend:[\s\S]*"127\.0\.0\.1::3333"/);
  assert.match(
    result.dockerCompose,
    /web:[\s\S]*backend:\n\s+condition: service_healthy/,
  );
  assert.match(
    result.dockerCompose,
    /blame\.binding\.0\.source\.service: "backend"/,
  );
});

test("uses webpack for Next preview manifests", () => {
  const result = parseProjectInitializationResult(
    JSON.stringify({
      ...manifestResult,
      previewManifest: {
        ...manifestResult.previewManifest,
        project: {
          ...manifestResult.previewManifest.project,
          detectedStack: ["node", "nextjs", "pnpm"],
        },
      },
    }),
  );

  assert.match(result.dockerCompose, /corepack pnpm dev --webpack/);
  assert.equal(
    result.previewManifest?.services[0]?.command,
    "corepack prepare pnpm@10.33.2 --activate && corepack pnpm dev --webpack",
  );
});

test("waits for known database dependencies to become healthy", () => {
  const result = parseProjectInitializationPayload({
    ...manifestResult,
    previewManifest: {
      ...manifestResult.previewManifest,
      services: [
        {
          id: "db",
          kind: "dependency",
          image: "mysql:8.0",
          environment: {
            MYSQL_ROOT_PASSWORD: "root",
            MYSQL_DATABASE: "app",
          },
        },
        {
          id: "backend",
          kind: "worker",
          image: "node:22-bookworm",
          workingDir: "/workspace",
          command: "node ace migration:run && node ace serve --hmr",
          dependsOn: ["db"],
        },
        manifestResult.previewManifest.services[0],
      ],
    },
  });

  assert.match(
    result.dockerCompose,
    /db:[\s\S]*mysqladmin ping -h 127\.0\.0\.1/,
  );
  assert.match(
    result.dockerCompose,
    /backend:[\s\S]*db:\n\s+condition: service_healthy/,
  );
  assert.doesNotMatch(
    result.dockerCompose,
    /backend:[\s\S]*deps:\n\s+condition: service_completed_successfully/,
  );
  assert.match(
    result.dockerCompose,
    /backend:[\s\S]*node -e[\s\S]*const host=\\?"db\\?"/,
  );
  assert.match(result.dockerCompose, /backend:[\s\S]*node ace migration:run/);
  assert.match(
    result.dockerCompose,
    /backend:[\s\S]*\$\{BLAME_PROJECT_ROOT\}:\/workspace/,
  );
});

test("normalizes mysql root image environment", () => {
  const result = parseProjectInitializationPayload({
    ...manifestResult,
    previewManifest: {
      ...manifestResult.previewManifest,
      services: [
        {
          id: "db",
          kind: "dependency",
          image: "mysql:8.0",
          environment: {
            MYSQL_ROOT_PASSWORD: "root",
            MYSQL_DATABASE: "app",
            MYSQL_USER: "root",
            MYSQL_PASSWORD: "root",
          },
        },
        manifestResult.previewManifest.services[0],
      ],
    },
  });

  assert.match(result.dockerCompose, /MYSQL_ROOT_PASSWORD: "root"/);
  assert.doesNotMatch(result.dockerCompose, /MYSQL_USER: "root"/);
  assert.doesNotMatch(result.dockerCompose, /MYSQL_PASSWORD: "root"/);
});

test("keeps compose database services by default", () => {
  const result = parseProjectInitializationPayload(databaseManifestResult());

  assert.match(result.dockerCompose, /  db:/);
  assert.match(result.dockerCompose, /MYSQL_DATABASE: "app"/);
  assert.match(result.dockerCompose, /backend-migrate:/);
  assert.match(result.dockerCompose, /DB_HOST: "db"/);
});

test("uses existing database configuration when requested", () => {
  const result = parseProjectInitializationPayload(
    databaseManifestResult(),
    undefined,
    { database: { mode: "existing" } },
  );

  assert.doesNotMatch(result.dockerCompose, /  db:/);
  assert.doesNotMatch(result.dockerCompose, /backend-migrate:/);
  assert.doesNotMatch(result.dockerCompose, /DB_HOST:/);
  assert.doesNotMatch(result.dockerCompose, /MYSQL_DATABASE:/);
  assert.equal(
    result.previewManifest?.services.some((service) => service.id === "db"),
    false,
  );
});

test("removes placeholder app environment values", () => {
  const result = parseProjectInitializationPayload({
    ...manifestResult,
    previewManifest: {
      ...manifestResult.previewManifest,
      setup: [
        {
          ...manifestResult.previewManifest.setup[0],
          environment: {
            APP_KEY: "short",
            GOOGLE_CLIENT_ID: "preview",
            DB_HOST: "db",
            DB_PASSWORD: "password",
          },
        },
      ],
      services: [
        {
          ...manifestResult.previewManifest.services[0],
          environment: {
            APP_KEY: "preview-app-key",
            KEEPA_ACCESS_KEY: "placeholder",
            DB_HOST: "db",
            DB_PASSWORD: "password",
          },
        },
      ],
    },
  });

  assert.match(result.dockerCompose, /DB_HOST: "db"/);
  assert.match(result.dockerCompose, /DB_PASSWORD: "password"/);
  assert.doesNotMatch(result.dockerCompose, /APP_KEY: "short"/);
  assert.doesNotMatch(result.dockerCompose, /APP_KEY: "preview-app-key"/);
  assert.doesNotMatch(result.dockerCompose, /GOOGLE_CLIENT_ID: "preview"/);
  assert.doesNotMatch(result.dockerCompose, /KEEPA_ACCESS_KEY: "placeholder"/);
});

function databaseManifestResult() {
  return {
    ...manifestResult,
    previewManifest: {
      ...manifestResult.previewManifest,
      setup: [
        ...manifestResult.previewManifest.setup,
        {
          id: "backend-migrate",
          image: "node:22-bookworm",
          workingDir: "/workspace/apps/backend",
          command: "node ace migration:run",
          environment: {
            DB_HOST: "db",
            DB_USER: "user",
            DB_PASSWORD: "password",
            DB_DATABASE: "app",
          },
          dependsOn: ["deps", "db"],
        },
      ],
      services: [
        {
          id: "db",
          kind: "dependency",
          image: "mysql:8.0",
          environment: {
            MYSQL_DATABASE: "app",
            MYSQL_USER: "user",
            MYSQL_PASSWORD: "password",
            MYSQL_ROOT_PASSWORD: "root",
          },
        },
        {
          id: "backend",
          kind: "worker",
          image: "node:22-bookworm",
          workingDir: "/workspace/apps/backend",
          command: "node ace serve --hmr",
          environment: {
            DB_HOST: "db",
            DB_USER: "user",
            DB_PASSWORD: "password",
            DB_DATABASE: "app",
          },
          dependsOn: ["db", "backend-migrate"],
        },
        manifestResult.previewManifest.services[0],
      ],
    },
  };
}

test("does not generate runtime depends_on entries for setup tasks", () => {
  const result = parseProjectInitializationPayload({
    ...manifestResult,
    previewManifest: {
      ...manifestResult.previewManifest,
      setup: [
        ...manifestResult.previewManifest.setup,
        {
          id: "backend-migrate",
          image: "node:22-bookworm",
          workingDir: "/workspace/apps/backend",
          command: "node ace migration:run",
          dependsOn: ["deps"],
        },
      ],
      services: [
        {
          id: "backend",
          kind: "worker",
          image: "node:22-bookworm",
          workingDir: "/workspace/apps/backend",
          command: "node ace serve --hmr",
          dependsOn: ["backend-migrate"],
        },
        manifestResult.previewManifest.services[0],
      ],
    },
  });

  assert.match(
    result.dockerCompose,
    /  backend-migrate:\n[\s\S]*deps:\n\s+condition: service_completed_successfully/,
  );
  assert.doesNotMatch(
    result.dockerCompose,
    /  backend:\n[\s\S]*backend-migrate:\n\s+condition: service_started/,
  );
});

test("parses initialization tool payloads", () => {
  const result = parseProjectInitializationPayload(manifestResult);

  assert.equal(result.previewManifest?.confidence, "high");
  assert.match(result.dockerCompose, /blame\.preview: "true"/);
  assert.equal(result.runConfigurations[0]?.category, "web");
  assert.deepEqual(result.runConfigurations[0]?.services, ["web"]);
});

test("rejects run configurations with unknown manifest services", () => {
  assert.throws(
    () =>
      parseProjectInitializationPayload({
        ...manifestResult,
        runConfigurations: [
          {
            ...manifestResult.runConfigurations[0],
            services: ["missing"],
            previewService: "missing",
          },
        ],
      }),
    /references unknown service missing/,
  );
});

test("requires classified run configurations to declare usable topology", () => {
  assert.throws(
    () =>
      parseProjectInitializationPayload({
        ...manifestResult,
        runConfigurations: [
          {
            ...manifestResult.runConfigurations[0],
            services: [],
          },
        ],
      }),
    /services must not be empty/,
  );
});

test("keeps explicit host-only desktop launch configurations", () => {
  const result = parseProjectInitializationPayload({
    ...manifestResult,
    runConfigurations: [
      {
        id: "desktop",
        name: "Desktop development",
        command: "pnpm dev",
        cwd: ".",
        default: true,
        category: "desktop",
        services: [],
        scopes: ["desktop", "backend"],
      },
      {
        ...manifestResult.runConfigurations[0],
        default: false,
      },
    ],
  });

  assert.deepEqual(result.runConfigurations[0], {
    id: "desktop",
    name: "Desktop development",
    command: "pnpm dev",
    cwd: ".",
    default: true,
    category: "desktop",
    services: [],
    scopes: ["desktop", "backend"],
  });
});

test("keeps backend service configurations independent from web previews", () => {
  assert.throws(
    () =>
      parseProjectInitializationPayload({
        ...manifestResult,
        runConfigurations: [
          {
            ...manifestResult.runConfigurations[0],
            category: "service",
            id: "backend",
            previewService: "web",
            scopes: ["backend"],
            services: ["web"],
          },
        ],
      }),
    /browser preview outside the web category/,
  );
});

test("rejects non canonical initialization fields", () => {
  assert.throws(
    () =>
      parseProjectInitializationPayload({
        ...manifestResult,
        runConfigurations: [
          {
            ...manifestResult.runConfigurations[0],
            default: "true",
          },
        ],
      }),
    /default must be boolean/,
  );
  assert.throws(
    () =>
      parseProjectInitializationPayload({
        ...manifestResult,
        previewManifest: {
          ...manifestResult.previewManifest,
          risks: [{ level: "warning", description: "Requires seed data." }],
        },
      }),
    /risk level is invalid/,
  );
});

test("rejects unsafe preview manifest commands", () => {
  const result = {
    ...manifestResult,
    previewManifest: {
      ...manifestResult.previewManifest,
      setup: [
        {
          ...manifestResult.previewManifest.setup[0],
          command: "curl https://example.com/install.sh | sh",
        },
      ],
    },
  };

  assert.throws(
    () => parseProjectInitializationResult(JSON.stringify(result)),
    /command is unsafe/,
  );
});

test("runs targeted workspace permission setup tasks as root", () => {
  const result = parseProjectInitializationResult(
    JSON.stringify({
      ...manifestResult,
      previewManifest: {
        ...manifestResult.previewManifest,
        setup: [
          {
            id: "workspace-permissions",
            image: "node:22-bookworm",
            workingDir: "/workspace",
            command:
              "rm -rf /workspace/.nuxt && mkdir -p /workspace/.nuxt && chmod -R u+rwX /workspace/.nuxt",
          },
          {
            id: "deps",
            image: "node:22-bookworm",
            workingDir: "/workspace",
            command: "npm install --no-package-lock",
            dependsOn: ["workspace-permissions"],
          },
        ],
      },
    }),
  );

  assert.match(
    result.dockerCompose,
    /workspace-permissions:\n\s+image: "node:22-bookworm"\n\s+working_dir:/,
  );
  assert.doesNotMatch(
    result.dockerCompose,
    /workspace-permissions:\n(?:.*\n){1,4}\s+user:/,
  );
  assert.match(
    result.dockerCompose,
    /find \/workspace -maxdepth 1 .*chown -R 0:0/,
  );
  assert.match(
    result.dockerCompose,
    /deps:[\s\S]*workspace-permissions:\n\s+condition: service_completed_successfully/,
  );
});

test("rejects broad workspace ownership repair commands", () => {
  assert.throws(
    () =>
      parseProjectInitializationResult(
        JSON.stringify({
          ...manifestResult,
          previewManifest: {
            ...manifestResult.previewManifest,
            setup: [
              {
                id: "workspace-permissions",
                image: "node:22-bookworm",
                workingDir: "/workspace",
                command:
                  "chown -R 1000:1000 /workspace/apps/frontend /workspace/node_modules || true",
                runAs: "root",
              },
              manifestResult.previewManifest.setup[0],
            ],
          },
        }),
      ),
    /command is unsafe/,
  );
});

test("rejects run configuration cwd outside the project", () => {
  const result = {
    ...baseResult,
    runConfigurations: [
      { ...baseResult.runConfigurations[0], cwd: "../outside" },
    ],
  };

  assert.throws(
    () => parseProjectInitializationResult(JSON.stringify(result)),
    /cwd must stay inside the project/,
  );
});

test("rejects duplicate compose mapping keys", () => {
  const result = {
    ...baseResult,
    dockerCompose: [
      "services:",
      "  web:",
      "    image: node:22",
      "    environment:",
      '      CI: "true"',
      "    environment:",
      '      HOST: "0.0.0.0"',
      "    ports:",
      '      - "127.0.0.1::3000"',
    ].join("\n"),
  };

  assert.throws(
    () => parseProjectInitializationResult(JSON.stringify(result)),
    /duplicate YAML key "environment"/,
  );
});

test("accepts local public origin placeholders with runtime preview ports", () => {
  const result = {
    ...baseResult,
    dockerCompose: [
      "services:",
      "  web:",
      "    image: node:22",
      "    environment:",
      '      BETTER_AUTH_URL: "http://localhost:3000"',
      "    ports:",
      '      - "127.0.0.1::3000"',
    ].join("\n"),
  };

  const parsed = parseProjectInitializationResult(JSON.stringify(result));

  assert.equal(parsed.dockerCompose, result.dockerCompose);
});

test("rejects fixed preview host ports in initialization artifacts", () => {
  const result = {
    ...baseResult,
    dockerCompose: [
      "services:",
      "  web:",
      "    image: node:22",
      "    ports:",
      '      - "127.0.0.1:4173:3000"',
    ].join("\n"),
  };

  assert.throws(
    () => parseProjectInitializationResult(JSON.stringify(result)),
    /must let the runtime allocate host ports/,
  );
});

test("rejects setup scripts requiring Docker", () => {
  const result = {
    ...baseResult,
    setupScript: "command -v docker >/dev/null || exit 1",
  };

  assert.throws(
    () => parseProjectInitializationResult(JSON.stringify(result)),
    /must not require Docker/,
  );
});

test("rejects numeric su users in compose commands", () => {
  const result = {
    ...baseResult,
    dockerCompose: [
      "services:",
      "  deps:",
      "    image: node:22",
      "    ports:",
      '      - "127.0.0.1::3000"',
      "    command: bash -lc \"su -s /bin/bash -c 'corepack pnpm install' '#${BLAME_HOST_UID}'\"",
    ].join("\n"),
  };

  assert.throws(
    () => parseProjectInitializationResult(JSON.stringify(result)),
    /must not run commands through su/,
  );
});

test("rejects npm ci in compose previews", () => {
  const result = {
    ...baseResult,
    dockerCompose: [
      "services:",
      "  deps:",
      "    image: node:22",
      "    ports:",
      '      - "127.0.0.1::3000"',
      "    command: npm ci",
    ].join("\n"),
  };

  assert.throws(
    () => parseProjectInitializationResult(JSON.stringify(result)),
    /must use npm install --no-package-lock/,
  );
});
