import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { semanticWorkspaceTools } from "./cline-tools.js";
import { maximumSemanticParseBytes } from "./code-navigation-policy.js";
import { HarnessCostGovernor } from "./cost-governor.js";
import { languageCapabilityRegistry } from "./language-capabilities.js";
import { harnessSuccess, type HarnessToolResult } from "./protocol.js";
import { SemanticWorkspace } from "./semantic-workspace.js";

test("tool descriptions steer semantic navigation with generated extensions", () => {
  const descriptions = Object.fromEntries(
    semanticWorkspaceTools(process.cwd()).map(({ description, name }) => [
      name,
      description,
    ]),
  );
  assert.match(descriptions.search_code ?? "", /location is unknown/iu);
  assert.match(
    descriptions.search_code ?? "",
    /narrow path or language scope/iu,
  );
  assert.match(descriptions.outline_code ?? "", /narrow directory/iu);
  assert.match(descriptions.inspect_code ?? "", /exceptional fallback/iu);
  for (const extension of semanticExtensions()) {
    assert.match(descriptions.outline_code ?? "", new RegExp(extension));
    assert.match(descriptions.inspect_code ?? "", new RegExp(extension));
  }
});

test("large TSX and CSS raw reads become compact semantic outlines", async () => {
  await withNavigationWorkspace(async (root, sources) => {
    const workspace = new SemanticWorkspace(root, {
      taskContract: { session_id: "auto-narrow-source" },
    });
    for (const path of ["src/large.tsx", "src/large.css"] as const) {
      const result = success(
        await workspace.inspectCode({ target: { path }, view: "raw" }),
      );
      assert.equal(result.data.status, "auto_narrowed");
      if (result.data.status !== "auto_narrowed") continue;
      assert.equal(result.data.auto_narrowed_kind, "semantic_outline");
      assert.equal(result.data.content_coverage, "none");
      assert.equal(result.data.content, "");
      assert.equal(result.data.range_utf8_bytes, undefined);
      assert.equal(result.data.line_range, undefined);
      assert.deepEqual(result.data.requested_range_utf8_bytes, [
        0,
        Buffer.byteLength(sources[path]!),
      ]);
      assert.ok(result.data.items.length > 0);
      assert.match(result.data.items[0]?.symbol_ref ?? "", /^s_[a-z0-9]+$/u);
      assert.ok(
        result.data.read_returned_bytes < Buffer.byteLength(sources[path]!),
      );
      assert.ok(result.data.estimated_tokens_saved > 0);
    }
  });
});

test("small JSON remains complete and large plain text becomes a bounded preview", async () => {
  await withNavigationWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root);
    const json = success(
      await workspace.inspectCode({
        target: { path: "config.json" },
        view: "raw",
      }),
    );
    assert.equal(json.data.status, "content");
    assert.match(json.data.content, /"enabled": true/u);
    const text = success(
      await workspace.inspectCode({
        target: { path: "notes.txt" },
        view: "raw",
      }),
    );
    assert.equal(text.data.status, "auto_narrowed");
    if (text.data.status !== "auto_narrowed") return;
    assert.equal(text.data.auto_narrowed_kind, "bounded_preview");
    assert.ok(Buffer.byteLength(text.data.content) <= 2 * 1024);
    assert.equal(text.data.content_coverage, "partial");
    assert.deepEqual(text.data.range_utf8_bytes, [0, 2 * 1024]);
    assert.match(text.data.recommendation, /search_code|range_utf8_bytes/u);
  });
});

test("large explicit ranges are narrowed while genuinely targeted ranges remain readable", async () => {
  await withNavigationWorkspace(async (root, sources) => {
    await writeFile(join(root, "coverage.txt"), "a".repeat(10_000));
    const workspace = new SemanticWorkspace(root, {
      taskContract: { session_id: "range-classification" },
    });
    const size = Buffer.byteLength(sources["src/large.tsx"]!);
    const broad = success(
      await workspace.inspectCode({
        target: { path: "src/large.tsx" },
        view: "raw",
        range_utf8_bytes: [0, size],
      }),
    );
    assert.equal(broad.data.status, "auto_narrowed");
    if (broad.data.status !== "auto_narrowed") return;
    assert.equal(broad.data.requested_coverage_ratio, 1);
    assert.equal(broad.data.range_utf8_bytes, undefined);
    const targeted = success(
      await workspace.inspectCode({
        target: { path: "src/large.tsx" },
        view: "raw",
        range_utf8_bytes: [0, 128],
      }),
    );
    assert.equal(targeted.data.status, "content");
    assert.deepEqual(targeted.data.range_utf8_bytes, [0, 128]);
    const majority = success(
      await workspace.inspectCode({
        target: { path: "coverage.txt" },
        view: "raw",
        range_utf8_bytes: [1_000, 9_500],
      }),
    );
    assert.equal(majority.data.status, "auto_narrowed");
    if (majority.data.status !== "auto_narrowed") return;
    assert.equal(majority.data.requested_coverage_ratio, 0.85);
    assert.deepEqual(majority.data.range_utf8_bytes, [1_000, 3_048]);
    const minority = success(
      await workspace.inspectCode({
        target: { path: "coverage.txt" },
        view: "raw",
        range_utf8_bytes: [0, 4_000],
      }),
    );
    assert.equal(minority.data.status, "content");
  });
});

test("oversized and invalid semantic files use a bounded preview without parsing", async () => {
  await withNavigationWorkspace(async (root) => {
    await writeFile(
      join(root, "src/generated.tsx"),
      `export const generated = "${"x".repeat(maximumSemanticParseBytes)}";`,
    );
    await writeFile(
      join(root, "src/invalid.tsx"),
      "export function Broken( {\n".repeat(500),
    );
    const workspace = new SemanticWorkspace(root, {
      taskContract: { session_id: "bounded-semantic-fallback" },
    });
    const generatedOutline = success(
      await workspace.outlineCode({
        target: { path: "src/generated.tsx" },
      }),
    );
    const generated = success(
      await workspace.inspectCode({
        target: { path: "src/generated.tsx" },
        view: "raw",
      }),
    );
    const invalid = success(
      await workspace.inspectCode({
        target: { path: "src/invalid.tsx" },
        view: "raw",
      }),
    );
    assert.equal(generatedOutline.data.items.length, 0);
    assert.equal(generatedOutline.coverage.truncated, true);
    assert.equal(
      recordValue(generatedOutline.data.parse_quality[0]).reason,
      "semantic_parse_limit",
    );
    assertAutoNarrowedFallback(generated, "semantic_parse_limit");
    assertAutoNarrowedFallback(invalid, "semantic_outline_unavailable");
  });
});

test("a truncated outline cannot trigger compensating full raw reads", async () => {
  await withNavigationWorkspace(async (root, sources) => {
    const workspace = new SemanticWorkspace(root, {
      taskContract: { session_id: "truncated-outline" },
    });
    const outline = success(
      await workspace.outlineCode({
        target: { path: "src/large.tsx" },
        budget: { max_items: 1, max_output_tokens: 200 },
      }),
    );
    assert.equal(outline.coverage.truncated, true);
    const rawReads = await Promise.all([
      workspace.inspectCode({ target: { path: "src/large.tsx" }, view: "raw" }),
      workspace.inspectCode({ target: { path: "src/large.tsx" }, view: "raw" }),
    ]);
    for (const result of rawReads) {
      const narrowed = success(result);
      assert.equal(narrowed.data.status, "auto_narrowed");
      assert.notEqual(narrowed.data.content, sources["src/large.tsx"]);
    }
  });
});

test("identical broad reads in flight execute only once", async () => {
  await withNavigationWorkspace(async (root) => {
    let executions = 0;
    let releaseExecution: () => void = () => undefined;
    const executionGate = new Promise<void>((resolve) => {
      releaseExecution = resolve;
    });
    const tools = semanticWorkspaceTools(root, {
      governor: new HarnessCostGovernor(80, false),
      executor: async () => {
        executions += 1;
        await executionGate;
        return contentReceipt();
      },
    });
    const inspect = tools.find(({ name }) => name === "inspect_code");
    assert.ok(inspect);
    let settledReads = 0;
    const reads = Array.from({ length: 8 }, (_, index) =>
      inspect
        .execute(
          { target: { path: "src/large.tsx" }, view: "raw" },
          toolContext(`parallel-${index}`),
        )
        .then((result: unknown) => {
          settledReads += 1;
          return result;
        }),
    );
    await waitFor(() => executions === 1);
    await waitFor(() => settledReads === 7);
    releaseExecution();
    const results = await Promise.all(reads);
    assert.equal(executions, 1);
    assert.equal(results.filter(isInFlightSuppression).length, 7);
    assert.equal(results.some(isToolError), false);
    for (const receipt of results.filter(isInFlightSuppression)) {
      assert.equal(resultData(receipt).content_coverage, "none");
      assert.equal(resultData(receipt).range_utf8_bytes, undefined);
      const coverage = recordValue(recordValue(receipt).coverage);
      assert.equal(coverage.scope, "unknown");
    }
  });
});

test("one quota covers broad search, outline, and raw inspection", async () => {
  await withNavigationWorkspace(async (root) => {
    const executions: string[] = [];
    let releaseExecution: () => void = () => undefined;
    const executionGate = new Promise<void>((resolve) => {
      releaseExecution = resolve;
    });
    const tools = semanticWorkspaceTools(root, {
      governor: new HarnessCostGovernor(80, false),
      executor: async ({ tool }) => {
        executions.push(tool);
        await executionGate;
        return contentReceipt();
      },
    });
    const search = requiredTool(tools, "search_code");
    const outline = requiredTool(tools, "outline_code");
    const inspect = requiredTool(tools, "inspect_code");
    let searching: Promise<unknown> | undefined;
    let outlining: Promise<unknown> | undefined;
    try {
      searching = search.execute(
        { query: { kind: "text", pattern: "Component" } },
        toolContext("broad-search"),
      );
      await waitFor(() => executions.length === 1);
      outlining = outline.execute(
        { target: { path: "." } },
        toolContext("broad-outline"),
      );
      await waitFor(() => executions.length === 2);
      const suppressed = await withTimeout(
        inspect.execute(
          { target: { path: "src/large.tsx" }, view: "raw" },
          toolContext("broad-inspect"),
        ),
      );
      assert.equal(resultData(suppressed).parallel_broad_read_suppressed, true);
      assert.equal(isToolError(suppressed), false);
    } finally {
      releaseExecution();
    }
    await Promise.all([searching, outlining]);
    assert.deepEqual(executions.sort(), ["outline_code", "search_code"]);
  });
});

test("US-015 headless navigation contract reduces tokens before the first edit", async () => {
  await withNavigationWorkspace(async (root, sources) => {
    const workspace = new SemanticWorkspace(root, {
      taskContract: { session_id: "us015-navigation" },
    });
    const search = success(
      await workspace.searchCode({
        query: { kind: "text", pattern: "Component42" },
        scope: { paths: ["src/large.tsx"] },
        max_results: 5,
      }),
    );
    assert.equal(search.data.items[0]?.path, "src/large.tsx");
    const outline = success(
      await workspace.outlineCode({
        target: { path: "src/large.tsx" },
        budget: { max_items: 10, max_output_tokens: 1_000 },
      }),
    );
    assert.equal(outline.coverage.truncated, true);
    const symbol = outline.data.items.find(
      ({ qualified_name }) => qualified_name === "Component42",
    );
    assert.ok(symbol);
    const inspected = success(
      await workspace.inspectCode({
        target: { symbol_ref: symbol.symbol_ref },
        view: "body",
      }),
    );
    assert.match(inspected.data.content, /data-index="42"/u);
    const targetedTokens = estimatedTokens([search, outline, inspected]);
    const completeRawTokens = Math.ceil(
      Buffer.byteLength(sources["src/large.tsx"]!) / 4,
    );
    assert.ok(targetedTokens < completeRawTokens * 0.6);
    const edited = success(
      await workspace.editSymbol({
        path: "src/large.tsx",
        symbolRef: symbol.symbol_ref,
        replacement:
          'export function Component42() { return <section data-index="updated-42" />; }',
      }),
    );
    assert.equal(edited.data.status, "applied");
  });
});

function navigationSources() {
  const componentIndexes = [
    42,
    ...Array.from({ length: 180 }, (_, index) => index).filter(
      (index) => index !== 42,
    ),
  ];
  const tsx = componentIndexes
    .map(
      (index) =>
        `export function Component${index}() { return <section data-index="${index}">${"content ".repeat(4)}</section>; }`,
    )
    .join("\n");
  const css = Array.from(
    { length: 220 },
    (_, index) =>
      `.item-${index} { color: rgb(${index % 255}, 20, 30); padding: ${index}px; }`,
  ).join("\n");
  return {
    "config.json": JSON.stringify({ enabled: true, theme: "dark" }, null, 2),
    "notes.txt": "navigation note with unsupported syntax\n".repeat(400),
    "src/large.css": css,
    "src/large.tsx": tsx,
  } satisfies Record<string, string>;
}

function semanticExtensions() {
  return [
    ...new Set(
      languageCapabilityRegistry
        .filter(({ symbolInspection }) => symbolInspection)
        .flatMap(({ extensions }) => extensions),
    ),
  ];
}

async function withNavigationWorkspace(
  operation: (
    root: string,
    sources: ReturnType<typeof navigationSources>,
  ) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "blame-us015-navigation-"));
  const sources = navigationSources();
  try {
    await mkdir(join(root, "src"), { recursive: true });
    for (const [path, content] of Object.entries(sources))
      await writeFile(join(root, path), content);
    await operation(root, sources);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function contentReceipt() {
  return harnessSuccess({
    data: { status: "content" },
    provenance: [],
    revision: {},
    startedAt: Date.now(),
  });
}

function success<T>(result: HarnessToolResult<T>) {
  if (result.status !== "success") assert.fail(JSON.stringify(result));
  return result;
}

function resultData(value: unknown) {
  if (!value || typeof value !== "object") return {};
  const result = value as Record<string, unknown>;
  return result.data && typeof result.data === "object"
    ? (result.data as Record<string, unknown>)
    : {};
}

function isInFlightSuppression(value: unknown) {
  return resultData(value).duplicate_broad_read_suppressed === true;
}

function isToolError(value: unknown) {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as { isError?: boolean }).isError,
  );
}

function toolContext(toolCallId: string) {
  return { agentId: "test", iteration: 1, toolCallId };
}

function requiredTool(
  tools: ReturnType<typeof semanticWorkspaceTools>,
  name: string,
) {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool);
  return tool;
}

function assertAutoNarrowedFallback(
  result: HarnessToolResult<unknown>,
  reason: string,
) {
  const narrowed = success(result);
  const data = resultData(narrowed);
  assert.equal(data.status, "auto_narrowed");
  assert.equal(data.auto_narrowed_kind, "bounded_preview");
  assert.equal(data.auto_narrow_reason, reason);
  assert.ok(Buffer.byteLength(String(data.content)) <= 2 * 1024);
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function estimatedTokens(value: unknown) {
  return Math.ceil(Buffer.byteLength(JSON.stringify(value)) / 4);
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Timed out while waiting for broad read reservations.");
}

async function withTimeout<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("Timed out waiting for suppression.")),
      500,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
