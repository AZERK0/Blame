import assert from "node:assert/strict";
import test from "node:test";
import {
  composeRuntimeServiceClosure,
  composeServiceHealthcheckCommand,
  composeSetupTaskEnvironment,
  previewComposePlan,
  type PreviewComposeConfig,
} from "./preview-compose-plan.ts";

function amazonScraperCompose(): PreviewComposeConfig {
  return {
    services: {
      "blame-volumes-init": { image: "node:22-bookworm-slim" },
      deps: {
        labels: { "blame.setup": "true" },
        depends_on: {
          "blame-volumes-init": {
            condition: "service_completed_successfully",
          },
        },
      },
      migrations: {
        command: "node ace migration:run",
        labels: { "blame.setup": "true" },
        environment: { COREPACK_HOME: "/tmp/corepack" },
        working_dir: "/workspace/apps/backend",
        depends_on: {
          deps: { condition: "service_completed_successfully" },
          db: { condition: "service_completed_successfully" },
        },
      },
      db: {
        image: "mysql:8.0",
        labels: {
          "blame.service.id": "db",
          "blame.service.kind": "dependency",
        },
        healthcheck: {
          test: ["CMD-SHELL", "mysqladmin ping --silent"],
        },
      },
      backend: {
        labels: {
          "blame.service.id": "backend",
          "blame.service.kind": "worker",
        },
        depends_on: { db: { condition: "service_healthy" } },
        environment: {
          DB_DATABASE: "amazon_scrapper",
          DB_HOST: "db",
          DB_PASSWORD: "blame",
          DB_PORT: "3306",
          DB_USER: "user",
        },
        working_dir: "/workspace/apps/backend",
      },
      frontend: {
        labels: {
          "blame.service.id": "frontend",
          "blame.service.kind": "preview",
        },
      },
    },
  };
}

test("keeps a mislabeled completed database dependency in the runtime lifecycle", () => {
  const plan = previewComposePlan(amazonScraperCompose());

  assert.deepEqual(plan.oneShotDependencies, ["blame-volumes-init"]);
  assert.deepEqual(plan.setupRuntimeDependencies, ["db"]);
  assert.deepEqual(plan.setupTasks, ["deps", "migrations"]);
  assert.deepEqual(plan.runtimeServices, ["db", "backend", "frontend"]);
});

test("compiles shell and exec healthchecks for readiness polling", () => {
  assert.deepEqual(
    composeServiceHealthcheckCommand({
      healthcheck: { test: ["CMD-SHELL", "mysqladmin ping --silent"] },
    }),
    ["sh", "-lc", "mysqladmin ping --silent"],
  );
  assert.deepEqual(
    composeServiceHealthcheckCommand({
      healthcheck: { test: ["CMD", "redis-cli", "ping"] },
    }),
    ["redis-cli", "ping"],
  );
});

test("expands selected services to their runtime dependencies", () => {
  assert.deepEqual(
    composeRuntimeServiceClosure(amazonScraperCompose(), ["backend"]),
    ["db", "backend"],
  );
});

test("inherits database connectivity for a colocated migration task", () => {
  assert.deepEqual(
    composeSetupTaskEnvironment(amazonScraperCompose(), "migrations"),
    {
      DB_DATABASE: "amazon_scrapper",
      DB_HOST: "db",
      DB_PASSWORD: "blame",
      DB_PORT: "3306",
      DB_USER: "user",
    },
  );
});
