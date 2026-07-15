import assert from "node:assert/strict";
import test from "node:test";

import { generatedTitle } from "./title-generation.js";

const configurations = [
  {
    id: "customer-app",
    name: "Customer app",
    command: "pnpm dev",
    cwd: "apps/customer",
    default: true,
    category: "web" as const,
    services: ["customer"],
    previewService: "customer",
    scopes: ["customer", "backend"],
  },
];

test("parses a title and selected run configuration", () => {
  assert.deepEqual(
    generatedTitle(
      JSON.stringify({
        title: "Improve customer billing flow",
        runConfigurationId: "customer-app",
      }),
      { runConfigurations: configurations },
    ),
    {
      title: "Improve customer billing flow",
      runConfigurationId: "customer-app",
    },
  );
});

test("drops unknown run configuration selections", () => {
  assert.deepEqual(
    generatedTitle(
      JSON.stringify({ title: "Improve API", runConfigurationId: "unknown" }),
      { runConfigurations: configurations },
    ),
    { title: "Improve API" },
  );
});

test("keeps legacy plain title responses compatible", () => {
  assert.deepEqual(generatedTitle("Improve the customer dashboard"), {
    title: "Improve the customer dashboard",
  });
});
