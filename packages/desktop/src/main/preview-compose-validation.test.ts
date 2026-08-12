import assert from "node:assert/strict";
import test from "node:test";
import {
  previewComposeEnvOverrides,
  validatePreviewComposeBindings,
} from "./preview-compose-validation.ts";

function compose(value: string) {
  return [
    "services:",
    "  backend:",
    "    image: node:22",
    "  web:",
    "    image: node:22",
    "    working_dir: /workspace/apps/web",
    "    environment:",
    `      API_URL: ${JSON.stringify(value)}`,
    "    labels:",
    '      blame.binding.0.key: "API_URL"',
    '      blame.binding.0.source.service: "backend"',
    '      blame.binding.0.exposure: "server"',
    '      blame.binding.0.format: "url"',
  ].join("\n");
}

test("accepts a server binding using compose DNS", () => {
  assert.doesNotThrow(() =>
    validatePreviewComposeBindings(compose("http://backend:3333")),
  );
});

test("rejects a server binding using container localhost", () => {
  assert.throws(
    () => validatePreviewComposeBindings(compose("http://localhost:3333")),
    /declared topology/,
  );
});

test("rejects unresolved browser binding placeholders", () => {
  assert.throws(
    () =>
      validatePreviewComposeBindings(
        "services: {}\nvalue: __BLAME_PREVIEW_PORT_backend_3000__",
      ),
    /unresolved browser binding/,
  );
});

test("extracts per-service env file overrides", () => {
  assert.deepEqual(previewComposeEnvOverrides(compose("http://backend:3333")), [
    {
      directory: "apps/web",
      values: { API_URL: "http://backend:3333" },
    },
  ]);
});
