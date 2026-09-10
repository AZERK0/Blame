import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import fg from "fast-glob";
import type { TaskCatalogItem } from "./task-catalog.js";

const nativeManifests = new Set([
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
  "pytest.ini",
  "setup.cfg",
  "pom.xml",
]);

export async function nativeTaskCatalog(
  root: string,
  workspaceFiles?: string[],
) {
  const files =
    workspaceFiles ??
    (await fg(["**/{Cargo.toml,go.mod,pom.xml,pyproject.toml,pytest.ini,setup.cfg}", "**/*.csproj"], {
      cwd: root,
      ignore: [
        "**/node_modules/**",
        "**/.git/**",
        "**/.blame/**",
        "**/.venv/**",
        "**/venv/**",
        "**/target/**",
      ],
    }));
  const candidates = files
    .filter((path) =>
      nativeManifests.has(basename(path)) || path.endsWith(".csproj"),
    )
    .slice(0, 200);
  const tasks = await Promise.all(
    candidates.map((path) => nativeManifestTask(root, path)),
  );
  return [
    ...new Map(
      tasks.flatMap((task) => (task ? [[task.task_id, task] as const] : [])),
    ).values(),
  ];
}

async function nativeManifestTask(root: string, path: string) {
  const cwd = dirname(path).replaceAll("\\", "/");
  if (basename(path) === "Cargo.toml")
    return nativeTest("cargo", ["test"], cwd);
  if (basename(path) === "go.mod")
    return nativeTest("go", ["test", "./..."], cwd);
  if (basename(path) === "pom.xml")
    return nativeTest("mvn", ["-f", "pom.xml", "test"], cwd, "maven:test");
  if (path.endsWith(".csproj"))
    return nativeTest(
      "dotnet",
      ["test", basename(path)],
      cwd,
      `${basename(path)}:test`,
    );
  const content = await readFile(join(root, path), "utf8");
  if (declaresPytest(basename(path), content))
    return nativeTest("python3", ["-m", "pytest"], cwd);
  return undefined;
}

function declaresPytest(name: string, content: string) {
  if (name === "pytest.ini") return true;
  if (name === "setup.cfg") return /^\s*\[tool:pytest\]\s*$/mu.test(content);
  return /^\s*\[tool\.pytest(?:\.ini_options)?\]\s*$/mu.test(content);
}

function nativeTest(
  executable: string,
  args: string[],
  cwd: string,
  label = `${executable}:test`,
): TaskCatalogItem {
  return {
    task_id: cwd === "." ? label : `${cwd}:${label}`,
    kind: "test",
    command: [executable, ...args].join(" "),
    cwd,
    invocation: { executable, args, cwd },
    dependencyPolicy: "optional",
    requiresNetwork: false,
    supportsFileSelection: false,
  };
}
