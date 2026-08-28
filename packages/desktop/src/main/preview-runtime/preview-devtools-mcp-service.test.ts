import assert from "node:assert/strict";
import test from "node:test";
import {
  previewDevtoolsEnabledCapabilities,
  previewDevtoolsMcpArgs,
  previewDevtoolsMcpVersion,
  previewDevtoolsServerArgs,
  previewDevtoolsUnavailableCapabilities,
} from "../preview-browser/preview-devtools-config.ts";
import {
  PreviewDevtoolsMcpService,
  scopedArtifactOutputPath,
  scopedPreviewPageId,
  workspaceUploadRelativePath,
} from "./preview-devtools-mcp-service.ts";
import toolCatalog from "./preview-devtools-tool-catalog.json" with { type: "json" };

test("uses the verified Google MCP version and important compatible flags", () => {
  const browserUrl = "http://127.0.0.1:9222";
  const args = previewDevtoolsMcpArgs(browserUrl);

  assert.equal(previewDevtoolsMcpVersion, "1.8.0");
  assert.deepEqual(args.slice(0, 2), ["-y", "chrome-devtools-mcp@1.8.0"]);
  assert.deepEqual(args.slice(2), previewDevtoolsServerArgs(browserUrl));
  assert.ok(args.includes("--memory-debugging"));
  assert.ok(args.includes("--experimental-vision"));
  assert.ok(args.includes("--experimental-structured-content"));
  assert.ok(args.includes("--category-experimental-third-party"));
  assert.ok(args.includes("--page-id-routing"));
  assert.ok(args.includes("--redact-network-headers"));
  assert.ok(args.includes("--no-performance-crux"));
});

test("catalog exposes every compatible scoped tool without page selection", async () => {
  const service = new PreviewDevtoolsMcpService();
  const tools = await service.listTools();
  const names = new Set(tools.map(({ name }) => name));

  assert.equal(toolCatalog.source, "chrome-devtools-mcp");
  assert.equal(toolCatalog.license, "Apache-2.0");
  assert.equal(toolCatalog.version, previewDevtoolsMcpVersion);
  assert.equal(tools.length, 40);
  assert.ok(names.has("take_snapshot"));
  assert.ok(names.has("take_screenshot"));
  assert.ok(names.has("lighthouse_audit"));
  assert.ok(names.has("take_heapsnapshot"));
  assert.ok(names.has("click_at"));
  assert.ok(names.has("execute_3p_developer_tool"));
  assert.equal(names.has("list_pages"), false);
  assert.equal(names.has("select_page"), false);
  assert.equal(names.has("new_page"), false);
  assert.equal(names.has("close_page"), false);
  assert.ok(tools.every((tool) => !schemaHasPageId(tool.inputSchema)));
  assert.ok(tools.every((tool) => !schemaRequiresPageId(tool.inputSchema)));
});

test("hidden and unknown tools fail before opening an MCP connection", async () => {
  const service = new PreviewDevtoolsMcpService();
  const input = {
    browserUrl: "http://127.0.0.1:1",
    currentUrl: "about:blank",
    scope: "test",
    worktree: process.cwd(),
  };

  await assert.rejects(
    service.call({ ...input, toolName: "list_pages" }),
    /tool is unavailable/,
  );
  await assert.rejects(
    service.call({ ...input, toolName: "unknown_tool" }),
    /tool is unavailable/,
  );
});

test("capability report distinguishes enabled and incompatible features", () => {
  const enabled = new Set(previewDevtoolsEnabledCapabilities);
  const unavailable = new Set(
    previewDevtoolsUnavailableCapabilities.map(({ capability }) => capability),
  );

  assert.ok(enabled.has("memory"));
  assert.ok(enabled.has("vision"));
  assert.ok(enabled.has("third-party"));
  assert.ok(enabled.has("page-id-routing"));
  assert.deepEqual(
    unavailable,
    new Set(["extensions", "pwa", "webmcp", "screencast"]),
  );
});

test("page routing selects only the scoped preview target", () => {
  const pages = [
    { id: 1, url: "http://127.0.0.1:3000/#first" },
    { id: 2, url: "http://127.0.0.1:3000/#second" },
  ];

  assert.equal(scopedPreviewPageId(pages, "http://127.0.0.1:3000/#second"), 2);
  assert.throws(
    () => scopedPreviewPageId(pages, "http://127.0.0.1:3000/"),
    /Multiple DevTools pages/,
  );
  assert.throws(
    () => scopedPreviewPageId(pages, "http://127.0.0.1:4000/"),
    /no longer available/,
  );
});

test("runtime upload staging cannot escape the scoped worktree", () => {
  const worktree = "/home/blame/runtime/worktrees/story";

  assert.equal(
    workspaceUploadRelativePath(worktree, "fixtures/avatar.png"),
    "fixtures/avatar.png",
  );
  assert.equal(
    workspaceUploadRelativePath(
      worktree,
      "/home/blame/runtime/worktrees/story/data/input.csv",
    ),
    "data/input.csv",
  );
  assert.throws(
    () => workspaceUploadRelativePath(worktree, "../secret.txt"),
    /inside the workspace/,
  );
  assert.throws(
    () => workspaceUploadRelativePath(worktree, "/etc/passwd"),
    /inside the workspace/,
  );
});

test("DevTools output files remain inside the private artifact scope", () => {
  const artifacts = "/tmp/blame-preview-devtools-test";

  assert.equal(
    scopedArtifactOutputPath(artifacts, "reports/audit.json"),
    "/tmp/blame-preview-devtools-test/reports/audit.json",
  );
  assert.throws(
    () => scopedArtifactOutputPath(artifacts, "../outside.json"),
    /inside their scope/,
  );
  assert.throws(
    () => scopedArtifactOutputPath(artifacts, "/etc/hosts"),
    /inside their scope/,
  );
});

function schemaHasPageId(schema: Record<string, unknown>) {
  if (!schema.properties || typeof schema.properties !== "object") return false;
  return "pageId" in schema.properties;
}

function schemaRequiresPageId(schema: Record<string, unknown>) {
  return Array.isArray(schema.required) && schema.required.includes("pageId");
}
