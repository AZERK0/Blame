import { readFile } from "node:fs/promises";

export async function scenarioChecks(id, workspace, result, events) {
  const checks = await checkFunctions[id]?.(workspace);
  if (!checks) throw new Error(`Unknown scenario ${id}.`);
  return [...checks, ...traceChecks(id, result, events)];
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
    check("fee threshold", /totalCents\s*<\s*100_?000/u.test(source)),
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
  const identifiers = source.match(/project-\d{3}/gu) ?? [];
  const titles = source.match(/Project \d{3}/gu) ?? [];
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
        (source.match(/status:\s*["']published["']/gu) ?? []).length === 120,
    ),
  ];
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

function check(name, passed) {
  return { name, passed };
}
