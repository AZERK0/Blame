import { readFile } from "node:fs/promises";
import { Script, createContext } from "node:vm";
import ts from "typescript";

export async function scenarioChecks(id, workspace) {
  const checks = await checkFunctions[id]?.(workspace);
  if (!checks) throw new Error(`Unknown scenario ${id}.`);
  return checks;
}

export function scenarioHarnessChecks(id, result, events) {
  return traceChecks(id, result, events);
}

const checkFunctions = {
  "symbol-function": checkSymbolFunction,
  "tsx-hybrid": checkTsxHybrid,
  "css-media": checkCssMedia,
  "symbol-rebase": checkSymbolRebase,
  "large-navigation": checkLargeNavigation,
  "large-create": checkLargeCreate,
  "task-selection": checkTaskSelection,
  "proof-freshness": checkProofFreshness,
  "read-deduplication": checkReadDeduplication,
  "backend-cross-file": checkBackendCrossFile,
  "window-boundaries": checkWindowBoundaries,
  "money-refactor": checkMoneyRefactor,
  "permission-matrix": checkPermissionMatrix,
  "filter-accessibility": checkFilterAccessibility,
  "stale-save-reducer": checkStaleSaveReducer,
  "async-cache": checkAsyncCache,
  "storage-traversal": checkStorageTraversal,
  "prisma-category": checkPrismaCategory,
  "motion-accessibility": checkMotionAccessibility,
  "strict-indexing": checkStrictIndexing,
  "slug-contract": checkSlugContract,
  "csv-parser": checkCsvParser,
  "stable-pagination": checkStablePagination,
  "webhook-idempotency": checkWebhookIdempotency,
  "status-migration": checkStatusMigration,
};

async function checkSymbolFunction(workspace) {
  const source = await sourceFile(workspace, "src/project-label.ts");
  return [
    check(
      "trimmed project label",
      /return `Project · \$\{name\.trim\(\)\}`;/u.test(source),
    ),
  ];
}

async function checkTsxHybrid(workspace) {
  const source = await sourceFile(workspace, "src/ProjectCard.tsx");
  return [
    check(
      "badge import",
      /import\s+\{\s*ProjectBadge\s*\}\s+from\s+["']\.\/ProjectBadge["']/u.test(
        source,
      ),
    ),
    check(
      "badge before title",
      /<ProjectBadge\s*\/>[\s\S]*<h2>\{title\}<\/h2>/u.test(source),
    ),
    check("artist attribute preserved", /data-artist=\{artist\}/u.test(source)),
  ];
}

async function checkCssMedia(workspace) {
  const source = await sourceFile(workspace, "src/styles.css");
  const media = source.slice(source.indexOf("@media (max-width: 720px)"));
  return [
    check(
      "responsive project grid",
      /\.hero\s*\{[\s\S]*?\}\s*\.project-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr;[\s\S]*?gap:\s*1\.25rem;/u.test(
        media,
      ),
    ),
    check(
      "desktop grid preserved",
      /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/u.test(source),
    ),
  ];
}

async function checkSymbolRebase(workspace) {
  const source = await sourceFile(workspace, "src/pricing.ts");
  return [
    check(
      "fee threshold",
      /totalCents\s*<\s*100_?000/u.test(source) ||
        /totalCents\s*>=\s*100_?000/u.test(source),
    ),
    check(
      "three percent fee",
      /Math\.round\(totalCents\s*\*\s*0\.03\)/u.test(source),
    ),
    check(
      "updated fee description",
      /calculateServiceFee\(totalCents\)\s*>\s*0\s*\?\s*["']standard["']\s*:\s*["']none["']/u.test(
        source,
      ),
    ),
  ];
}

async function checkLargeNavigation(workspace) {
  const source = await sourceFile(workspace, "src/project-registry.ts");
  const body = source.slice(
    source.indexOf("export function selectFeaturedProjects"),
  );
  return [
    check("featured filter", /filter\([^\n]*featured/u.test(body)),
    check("rank sort", /sort\([^\n]*rank/u.test(body)),
    check(
      "registry preserved",
      (source.match(/id: "project-/gu) ?? []).length === 180,
    ),
  ];
}

async function checkLargeCreate(workspace) {
  const source = await sourceFile(workspace, "src/project-seed.ts");
  const seeds = source.slice(source.indexOf("PROJECT_SEEDS"));
  const identifiers = fieldValues(source, "id", /project-\d{3}/u);
  const titles = fieldValues(source, "title", /Project \d{3}/u);
  return [
    check("large file", Buffer.byteLength(source) > 10_000),
    check("seed type", /export\s+type\s+ProjectSeed/u.test(source)),
    check("seed export", /export\s+const\s+PROJECT_SEEDS/u.test(source)),
    check(
      "120 identifiers",
      identifiers.length === 120 &&
        identifiers[0] === "project-001" &&
        identifiers.at(-1) === "project-120",
    ),
    check(
      "120 titles and statuses",
      titles.length === 120 &&
        (seeds.match(/status:\s*["']published["']/gu) ?? []).length === 120,
    ),
  ];
}

function fieldValues(source, field, pattern) {
  const matches = source.matchAll(
    new RegExp(`\\b${field}:\\s*["'](${pattern.source})["']`, "gu"),
  );
  return [...matches].map((match) => match[1]);
}

async function checkTaskSelection(workspace) {
  const source = await sourceFile(workspace, "src/project-label.ts");
  return [
    check(
      "middle-dot separator",
      /labelSeparator\s*=\s*["'] · ["']/u.test(source),
    ),
  ];
}

async function checkProofFreshness(workspace) {
  const label = await sourceFile(workspace, "src/project-label.ts");
  const styles = await sourceFile(workspace, "src/styles.css");
  return [
    check("em-dash separator", /labelSeparator\s*=\s*["'] — ["']/u.test(label)),
    check(
      "balanced title",
      /\.project-title\s*\{[^}]*text-wrap:\s*balance;/u.test(styles),
    ),
  ];
}

async function checkReadDeduplication(workspace) {
  const source = await sourceFile(workspace, "src/api/projects.ts");
  return [
    check(
      "empty title fallback",
      /title\.trim\(\)[\s\S]*["']Untitled project["']/u.test(source) ||
        /trimmedTitle[\s\S]*["']Untitled project["']/u.test(source),
    ),
  ];
}

async function checkBackendCrossFile(workspace) {
  const schema = await sourceFile(workspace, "prisma/schema.prisma");
  const api = await sourceFile(workspace, "src/api/projects.ts");
  return [
    check("unique slug", /slug\s+String\s+@unique/u.test(schema)),
    check(
      "published default",
      /published\s+Boolean\s+@default\(false\)/u.test(schema),
    ),
    check(
      "publication index",
      /@@index\(\[published,\s*createdAt\]\)/u.test(schema),
    ),
    check(
      "API type fields",
      /slug:\s*string/u.test(api) && /published:\s*boolean/u.test(api),
    ),
    check(
      "serialized fields",
      /slug:\s*project\.slug/u.test(api) &&
        /published:\s*project\.published/u.test(api),
    ),
  ];
}

async function checkWindowBoundaries(workspace) {
  const module = await typeScriptModule(workspace, "src/scheduling.ts");
  const overlap = module.windowsOverlap;
  return [
    await behaviorCheck("overlapping windows", () =>
      overlap({ start: 2, end: 8 }, { start: 7, end: 12 }),
    ),
    await behaviorCheck(
      "half-open boundary",
      () => !overlap({ start: 2, end: 8 }, { start: 8, end: 12 }),
    ),
    await behaviorCheck(
      "invalid windows rejected",
      () =>
        !overlap({ start: 4, end: 4 }, { start: 3, end: 9 }) &&
        !overlap({ start: 9, end: 2 }, { start: 3, end: 9 }),
    ),
  ];
}

async function checkMoneyRefactor(workspace) {
  const source = await sourceFile(workspace, "src/money.ts");
  const module = await typeScriptModule(workspace, "src/money.ts");
  return [
    check(
      "shared exported helper",
      /export\s+function\s+roundCurrency/u.test(source) &&
        (source.match(/roundCurrency\s*\(/gu) ?? []).length >= 3,
    ),
    await behaviorCheck(
      "currency behavior",
      () =>
        module.roundCurrency(12.346) === 12.35 &&
        module.formatPrice(12.346) === "12.35 EUR" &&
        module.discountedPrice(19.99, 15) === 16.99,
    ),
  ];
}

async function checkPermissionMatrix(workspace) {
  const module = await typeScriptModule(workspace, "src/permissions.ts");
  const allowed = module.canPerformProjectAction;
  return [
    await behaviorCheck("owner and viewer matrix", () =>
      ownerAndViewerPermissions(allowed),
    ),
    await behaviorCheck("editor matrix", () => editorPermissions(allowed)),
    await behaviorCheck(
      "unknown values denied",
      () =>
        !allowed("administrator", "view", "draft") &&
        !allowed("owner", "archive", "draft") &&
        !allowed("owner", "view", "deleted"),
    ),
  ];
}

function ownerAndViewerPermissions(allowed) {
  const actions = ["view", "edit", "publish", "delete"];
  const states = ["draft", "published", "archived"];
  return (
    states.every((state) =>
      actions.every((action) => allowed("owner", action, state)),
    ) &&
    states.every((state) =>
      actions.every(
        (action) => allowed("viewer", action, state) === (action === "view"),
      ),
    )
  );
}

function editorPermissions(allowed) {
  return (
    allowed("editor", "view", "archived") &&
    allowed("editor", "edit", "draft") &&
    allowed("editor", "edit", "published") &&
    allowed("editor", "publish", "draft") &&
    !allowed("editor", "publish", "published") &&
    !allowed("editor", "edit", "archived") &&
    !allowed("editor", "delete", "draft")
  );
}

async function checkFilterAccessibility(workspace) {
  const source = await sourceFile(workspace, "src/ProjectFilter.tsx");
  const input = source.match(/<input\b[^>]*>/u)?.[0] ?? "";
  const button = source.match(/<button\b[^>]*>[\s\S]*?<\/button>/u)?.[0] ?? "";
  return [
    check(
      "associated search label",
      /<label[^>]*htmlFor=["']project-search["'][^>]*>\s*Search projects\s*<\/label>/u.test(
        source,
      ) &&
        /\bid=["']project-search["']/u.test(input) &&
        /\btype=["']search["']/u.test(input),
    ),
    check(
      "pressed filter button",
      /\btype=["']button["']/u.test(button) &&
        /\baria-pressed=\{featuredOnly\}/u.test(button) &&
        (/\baria-label=["']Featured only["']/u.test(button) ||
          />\s*Featured only\s*<\/button>/u.test(button)),
    ),
    check(
      "polite result status",
      /<span[^>]*aria-live=["']polite["']/u.test(source),
    ),
  ];
}

async function checkStaleSaveReducer(workspace) {
  const module = await typeScriptModule(workspace, "src/project-reducer.ts");
  return [
    await behaviorCheck("start clears error", () =>
      reducerStartBehavior(module.projectSaveReducer),
    ),
    await behaviorCheck("stale responses ignored", () =>
      reducerStaleBehavior(module.projectSaveReducer),
    ),
    await behaviorCheck("active completion behavior", () =>
      reducerCompletionBehavior(module.projectSaveReducer),
    ),
  ];
}

function reducerStartBehavior(reducer) {
  const state = {
    error: "old",
    savedTitle: "Saved",
    status: "error",
    title: "Draft",
  };
  const next = reducer(state, { requestId: "r1", type: "save_started" });
  return (
    next.status === "saving" &&
    next.activeRequestId === "r1" &&
    !("error" in next)
  );
}

function reducerStaleBehavior(reducer) {
  const active = {
    activeRequestId: "r2",
    savedTitle: "Saved",
    status: "saving",
    title: "Current",
  };
  const success = reducer(active, { requestId: "r1", type: "save_succeeded" });
  const failure = reducer(active, {
    message: "late",
    requestId: "r1",
    type: "save_failed",
  });
  return (
    JSON.stringify(success) === JSON.stringify(active) &&
    JSON.stringify(failure) === JSON.stringify(active)
  );
}

function reducerCompletionBehavior(reducer) {
  const active = {
    activeRequestId: "r2",
    savedTitle: "Saved",
    status: "saving",
    title: "Current",
  };
  const success = reducer(active, { requestId: "r2", type: "save_succeeded" });
  const failure = reducer(active, {
    message: "failed",
    requestId: "r2",
    type: "save_failed",
  });
  return (
    success.savedTitle === "Current" &&
    success.status === "idle" &&
    !("activeRequestId" in success) &&
    failure.title === "Saved" &&
    failure.error === "failed" &&
    failure.status === "error" &&
    !("activeRequestId" in failure)
  );
}

async function checkAsyncCache(workspace) {
  const module = await typeScriptModule(workspace, "src/project-cache.ts");
  return [
    await behaviorCheck("concurrent load coalesced", () =>
      cacheCoalescingBehavior(module),
    ),
    await behaviorCheck("failed load evicted", () =>
      cacheFailureBehavior(module),
    ),
    await behaviorCheck("clear removes pending state", () =>
      cacheClearBehavior(module),
    ),
  ];
}

async function cacheCoalescingBehavior(module) {
  module.clearProjectCache();
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const load = () => {
    calls += 1;
    return pending;
  };
  const first = module.getCachedProject("one", load);
  const second = module.getCachedProject("one", load);
  release({ id: "one", title: "One" });
  const values = await Promise.all([first, second]);
  await module.getCachedProject("one", load);
  return calls === 1 && values[0] === values[1];
}

async function cacheFailureBehavior(module) {
  module.clearProjectCache();
  let calls = 0;
  await module
    .getCachedProject("retry", async () => {
      calls += 1;
      throw new Error("load failed");
    })
    .catch(() => undefined);
  const value = await module.getCachedProject("retry", async () => {
    calls += 1;
    return { id: "retry", title: "Recovered" };
  });
  return calls === 2 && value.title === "Recovered";
}

async function cacheClearBehavior(module) {
  module.clearProjectCache();
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const first = module.getCachedProject("clear", () => {
    calls += 1;
    return pending;
  });
  module.clearProjectCache();
  const second = module.getCachedProject("clear", async () => {
    calls += 1;
    return { id: "clear", title: "New" };
  });
  release({ id: "clear", title: "Old" });
  await Promise.all([first, second]);
  const current = await module.getCachedProject("clear", async () => {
    calls += 1;
    return { id: "clear", title: "Unexpected" };
  });
  return calls === 2 && current.title === "New";
}

async function checkStorageTraversal(workspace) {
  const module = await typeScriptModule(workspace, "src/storage-path.ts");
  const normalize = module.normalizeStorageKey;
  return [
    await behaviorCheck(
      "normal key normalized",
      () => normalize("projects//2026/./hero.jpg") === "projects/2026/hero.jpg",
    ),
    await behaviorCheck("traversal rejected", () =>
      ["../secret", "projects/%2e%2e/secret", "projects\\..\\secret"].every(
        (value) => normalize(value) === null,
      ),
    ),
    await behaviorCheck("absolute and invalid rejected", () =>
      ["", "/root/key", "\\server\\key", "C:\\secret", "%E0%A4%A"].every(
        (value) => normalize(value) === null,
      ),
    ),
  ];
}

async function checkPrismaCategory(workspace) {
  const schema = await sourceFile(workspace, "prisma/schema.prisma");
  const api = await sourceFile(workspace, "src/api/projects.ts");
  return [
    check(
      "category model",
      /model\s+ProjectCategory\s*\{[\s\S]*slug\s+String\s+@unique[\s\S]*projects\s+Project\[\]/u.test(
        schema,
      ),
    ),
    check(
      "optional indexed relation",
      /categoryId\s+String\?/u.test(schema) &&
        /category\s+ProjectCategory\?\s+@relation/u.test(schema) &&
        /@@index\(\[categoryId\]\)/u.test(schema),
    ),
    check(
      "category API contract",
      /category:\s*\{\s*slug:\s*string;?\s*\}\s*\|\s*null/u.test(api) &&
        /categorySlug:\s*project\.category\?\.slug\s*\?\?\s*null/u.test(api),
    ),
  ];
}

async function checkMotionAccessibility(workspace) {
  const source = await sourceFile(workspace, "src/styles.css");
  const reduced = source.slice(
    source.indexOf("@media (prefers-reduced-motion: reduce)"),
  );
  return [
    check(
      "visible keyboard focus",
      /\.carousel-control:focus-visible\s*\{[^}]*outline:\s*(?:[2-9]|\d{2,})px[^;}]*;[^}]*outline-offset:\s*[1-9]\d*px/u.test(
        source,
      ),
    ),
    check(
      "reduced carousel motion",
      /\.project-carousel\s*\{[^}]*scroll-behavior:\s*auto/u.test(reduced),
    ),
    check(
      "reduced card motion",
      /\.project-card\s*\{[^}]*transition:\s*none/u.test(reduced) &&
        /\.project-card\s*\{[^}]*transform:\s*none/u.test(reduced),
    ),
  ];
}

async function checkStrictIndexing(workspace) {
  const config = await sourceFile(workspace, "tsconfig.json");
  const module = await typeScriptModule(workspace, "src/project-index.ts");
  const titleAt = module.projectTitleAt;
  const projects = [{ id: "one", title: "First" }];
  return [
    check(
      "strict indexed access enabled",
      /"noUncheckedIndexedAccess"\s*:\s*true/u.test(config),
    ),
    await behaviorCheck(
      "known project title",
      () => titleAt(projects, 0) === "First",
    ),
    await behaviorCheck("invalid index fallback", () =>
      [-1, 1, 0.5].every(
        (index) => titleAt(projects, index) === "Unknown project",
      ),
    ),
  ];
}

async function checkSlugContract(workspace) {
  const source = await sourceFile(workspace, "src/project-url.ts");
  const module = await typeScriptModule(workspace, "src/slug.ts");
  return [
    await behaviorCheck(
      "normalized ASCII slug",
      () =>
        module.slugifyProject({ id: "42", title: "  Crème brûlée!!!  " }) ===
        "creme-brulee",
    ),
    await behaviorCheck(
      "empty title fallback",
      () =>
        module.slugifyProject({ id: "42", title: "🔥 !!!" }) === "project-42",
    ),
    check(
      "consumer passes project",
      /slugifyProject\(project\)/u.test(source) &&
        !/slugifyProject\(project\.title\)/u.test(source),
    ),
  ];
}

async function checkCsvParser(workspace) {
  const module = await typeScriptModule(workspace, "src/csv.ts");
  const parse = module.parseCsvRow;
  return [
    await behaviorCheck("quoted comma", () =>
      sameValues(parse('alpha,"beta,gamma",delta'), [
        "alpha",
        "beta,gamma",
        "delta",
      ]),
    ),
    await behaviorCheck("escaped quotes", () =>
      sameValues(parse('"A ""quoted"" title",  next '), [
        'A "quoted" title',
        "next",
      ]),
    ),
    await behaviorCheck("empty trailing field", () =>
      sameValues(parse("one,,three,"), ["one", "", "three", ""]),
    ),
    await behaviorCheck("quoted spaces preserved", () =>
      sameValues(parse('"  kept  ", trim me '), ["  kept  ", "trim me"]),
    ),
  ];
}

async function checkStablePagination(workspace) {
  const module = await typeScriptModule(workspace, "src/pagination.ts");
  const paginate = module.paginatePublishedProjects;
  const projects = paginationProjects();
  const before = JSON.stringify(projects);
  return [
    await behaviorCheck("stable published ordering", () =>
      sameValues(
        paginate(projects, 1, 3).map(({ id }) => id),
        ["a", "b", "d"],
      ),
    ),
    await behaviorCheck("second page", () =>
      sameValues(
        paginate(projects, 2, 2).map(({ id }) => id),
        ["d", "c"],
      ),
    ),
    await behaviorCheck("invalid pagination", () =>
      [
        paginate(projects, 0, 2),
        paginate(projects, 1.5, 2),
        paginate(projects, 1, -1),
      ].every((value) => value.length === 0),
    ),
    check("input preserved", JSON.stringify(projects) === before),
  ];
}

function paginationProjects() {
  return [
    { createdAt: "2025-01-01T00:00:00Z", id: "c", published: true },
    { createdAt: "2026-01-01T00:00:00Z", id: "b", published: true },
    { createdAt: "2026-01-01T00:00:00Z", id: "a", published: true },
    { createdAt: "2027-01-01T00:00:00Z", id: "hidden", published: false },
    { createdAt: "2025-06-01T00:00:00Z", id: "d", published: true },
  ];
}

async function checkWebhookIdempotency(workspace) {
  const module = await typeScriptModule(workspace, "src/webhook.ts");
  return [
    await behaviorCheck("concurrent webhook coalesced", () =>
      webhookConcurrencyBehavior(module),
    ),
    await behaviorCheck("successful duplicate ignored", () =>
      webhookDuplicateBehavior(module),
    ),
    await behaviorCheck("failed webhook retryable", () =>
      webhookFailureBehavior(module),
    ),
  ];
}

async function webhookConcurrencyBehavior(module) {
  module.clearProcessedWebhooks();
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const first = module.processWebhook("event", () => {
    calls += 1;
    return pending;
  });
  const second = module.processWebhook("event", () => {
    calls += 1;
    return Promise.resolve();
  });
  release();
  const values = await Promise.all([first, second]);
  return calls === 1 && sameValues(values, [true, false]);
}

async function webhookDuplicateBehavior(module) {
  let calls = 0;
  const duplicate = await module.processWebhook("event", async () => {
    calls += 1;
  });
  return duplicate === false && calls === 0;
}

async function webhookFailureBehavior(module) {
  module.clearProcessedWebhooks();
  await module
    .processWebhook("retry", async () => {
      throw new Error("failed");
    })
    .catch(() => undefined);
  const retried = await module.processWebhook("retry", async () => undefined);
  return retried === true;
}

async function checkStatusMigration(workspace) {
  const schema = await sourceFile(workspace, "prisma/schema.prisma");
  const migration = await sourceFile(
    workspace,
    "prisma/migrations/20260903000000_project_status/migration.sql",
  );
  const api = await sourceFile(workspace, "src/api/projects.ts");
  return [
    check(
      "Prisma status enum",
      /enum\s+ProjectStatus\s*\{[\s\S]*DRAFT[\s\S]*PUBLISHED[\s\S]*ARCHIVED[\s\S]*\}/u.test(
        schema,
      ),
    ),
    check(
      "Prisma status field and index",
      /status\s+ProjectStatus\s+@default\(DRAFT\)/u.test(schema) &&
        /@@index\(\[status,\s*createdAt\]\)/u.test(schema),
    ),
    check(
      "PostgreSQL enum migration",
      /CREATE\s+TYPE[\s\S]*ProjectStatus[\s\S]*DRAFT[\s\S]*PUBLISHED[\s\S]*ARCHIVED/iu.test(
        migration,
      ),
    ),
    check(
      "non-null column and index migration",
      /ADD\s+COLUMN[\s\S]*status[\s\S]*NOT\s+NULL[\s\S]*DEFAULT/iu.test(
        migration,
      ) && /CREATE\s+INDEX[\s\S]*status[\s\S]*createdAt/iu.test(migration),
    ),
    check(
      "serialized lowercase status",
      /status:\s*project\.status\.toLowerCase\(\)/u.test(api),
    ),
  ];
}

function traceChecks(id, result, events) {
  if (id === "proof-freshness")
    return [check("fresh terminal proof", result.verified === true)];
  if (id === "read-deduplication")
    return [
      check(
        "read deduplicated",
        result.metrics?.navigation?.deduplicatedReads >= 1,
      ),
    ];
  if (id === "symbol-function")
    return [
      check("symbol operation", result.metrics?.editing?.symbolOperations >= 1),
    ];
  if (id === "task-selection")
    return [check("root build selected", rootBuildSelected(events))];
  return [];
}

function rootBuildSelected(events) {
  return events.some((row) => {
    const payload = row.event?.payload ?? {};
    const input = payload.toolCall?.input ?? {};
    return (
      payload.phase === "started" &&
      (payload.toolName === "run_task" ||
        payload.toolCall?.name === "run_task") &&
      input.task === "build" &&
      input.packagePath !== "apps/web"
    );
  });
}

async function sourceFile(workspace, relativePath) {
  try {
    return await readFile(
      new URL(relativePath, `file://${workspace}/`),
      "utf8",
    );
  } catch {
    return "";
  }
}

async function typeScriptModule(workspace, relativePath) {
  try {
    const source = await sourceFile(workspace, relativePath);
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    const module = { exports: {} };
    const context = createContext({ exports: module.exports, module });
    new Script(output, { filename: relativePath }).runInContext(context, {
      timeout: 1_000,
    });
    return module.exports;
  } catch {
    return {};
  }
}

async function behaviorCheck(name, run) {
  try {
    return check(name, Boolean(await run()));
  } catch {
    return check(name, false);
  }
}

function sameValues(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function check(name, passed) {
  return { name, passed };
}
