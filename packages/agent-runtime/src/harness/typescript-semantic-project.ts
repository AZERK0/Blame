import { basename, dirname, posix, relative, resolve } from "node:path";
import ts from "typescript";
import { sha256 } from "./protocol.js";
import type { WorkspaceSnapshot } from "./workspace-files.js";

export type TypeScriptSemanticProject = {
  indexRevisionId: string;
  kind: "configured" | "inferred";
  program: ts.Program;
  service: ts.LanguageService;
};

type CachedProject = TypeScriptSemanticProject & {
  cacheKey: string;
};

const maximumProjectFiles = 5_000;
const maximumCachedProjects = 3;
const projectCache = new Map<string, CachedProject>();

export function typescriptSemanticProject(input: {
  root: string;
  snapshot: WorkspaceSnapshot;
  targetPath: string;
}) {
  const workspaceFiles = input.snapshot.files.filter(isTypeScriptProjectFile);
  if (!workspaceFiles.includes(input.targetPath)) return undefined;
  const configPath = nearestConfig(
    input.root,
    input.targetPath,
    input.snapshot.files,
  );
  const configuration = projectConfiguration(input, workspaceFiles, configPath);
  if (configuration.files.length > maximumProjectFiles)
    return "project_too_large";
  const effectiveConfigPath = configuration.configured ? configPath : undefined;
  const cacheKey = projectCacheKey(input, effectiveConfigPath);
  const cached = projectCache.get(cacheKey);
  if (cached) return refreshCachedProject(cacheKey, cached);
  const project = createProject(
    input,
    configuration,
    effectiveConfigPath,
    cacheKey,
  );
  projectCache.set(cacheKey, project);
  trimProjectCache();
  return project;
}

function createProject(
  input: { root: string; snapshot: WorkspaceSnapshot },
  configuration: ProjectConfiguration,
  configPath: string | undefined,
  cacheKey: string,
): CachedProject {
  const rootNames = configuration.files.map((path) =>
    resolve(input.root, path),
  );
  const service = ts.createLanguageService(
    languageServiceHost(input.root, rootNames, configuration.options, cacheKey),
    ts.createDocumentRegistry(),
  );
  const program = service.getProgram();
  if (!program) throw new Error("TypeScript language service has no program.");
  return {
    cacheKey,
    indexRevisionId: indexRevisionId(input.root, input.snapshot, configPath),
    kind: configPath ? "configured" : "inferred",
    program,
    service,
  };
}

function languageServiceHost(
  root: string,
  rootNames: string[],
  options: ts.CompilerOptions,
  projectVersion: string,
): ts.LanguageServiceHost {
  const snapshots = new Map<string, ts.IScriptSnapshot>();
  return {
    directoryExists: ts.sys.directoryExists,
    fileExists: ts.sys.fileExists,
    getCompilationSettings: () => options,
    getCurrentDirectory: () => root,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    getDirectories: ts.sys.getDirectories,
    getNewLine: () => ts.sys.newLine,
    getProjectVersion: () => projectVersion,
    getScriptFileNames: () => rootNames,
    getScriptSnapshot: (path) => scriptSnapshot(path, snapshots),
    getScriptVersion: () => projectVersion,
    readDirectory: ts.sys.readDirectory,
    readFile: ts.sys.readFile,
    realpath: ts.sys.realpath,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
  };
}

function scriptSnapshot(
  path: string,
  snapshots: Map<string, ts.IScriptSnapshot>,
) {
  const cached = snapshots.get(path);
  if (cached) return cached;
  const content = ts.sys.readFile(path);
  if (content === undefined) return undefined;
  const snapshot = ts.ScriptSnapshot.fromString(content);
  snapshots.set(path, snapshot);
  return snapshot;
}

function projectConfiguration(
  input: { root: string; snapshot: WorkspaceSnapshot; targetPath: string },
  workspaceFiles: string[],
  configPath?: string,
): ProjectConfiguration {
  const configured = configPath
    ? configuredProject(input.root, configPath, input.snapshot.files)
    : undefined;
  return {
    configured: Boolean(configured),
    files: configured
      ? [...new Set([input.targetPath, ...configured.files])]
      : workspaceFiles,
    options: semanticCompilerOptions(configured?.options),
  };
}

function configuredProject(root: string, configPath: string, files: string[]) {
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) return undefined;
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    dirname(configPath),
    undefined,
    configPath,
  );
  if (
    parsed.errors.some(
      (error) => error.category === ts.DiagnosticCategory.Error,
    )
  )
    return undefined;
  const workspaceFiles = new Set(files);
  return {
    files: parsed.fileNames
      .map((path) => workspaceRelativePath(root, path))
      .filter((path): path is string =>
        Boolean(path && workspaceFiles.has(path)),
      ),
    options: parsed.options,
  };
}

function semanticCompilerOptions(configured?: ts.CompilerOptions) {
  return {
    ...(configured ?? inferredCompilerOptions),
    allowJs: true,
    noEmit: true,
    skipLibCheck: true,
  } satisfies ts.CompilerOptions;
}

function nearestConfig(root: string, targetPath: string, files: string[]) {
  const candidates = files
    .filter((path) =>
      ["jsconfig.json", "tsconfig.json"].includes(basename(path)),
    )
    .filter((path) => containsPath(posix.dirname(path), targetPath))
    .sort((left, right) => right.length - left.length);
  return candidates[0] ? resolve(root, candidates[0]) : undefined;
}

function containsPath(directory: string, path: string) {
  return (
    directory === "." || path === directory || path.startsWith(`${directory}/`)
  );
}

function projectCacheKey(
  input: { root: string; snapshot: WorkspaceSnapshot },
  configPath?: string,
) {
  return [
    input.root,
    input.snapshot.revision.source_revision_id,
    configPath ?? "inferred",
    ts.version,
  ].join("\0");
}

function indexRevisionId(
  root: string,
  snapshot: WorkspaceSnapshot,
  configPath?: string,
) {
  const digest = sha256(
    [
      snapshot.revision.source_revision_id,
      configPath ? relativeConfig(root, configPath) : "inferred",
      ts.version,
    ].join("\0"),
  );
  return `idx_${digest.slice(0, 32)}`;
}

function relativeConfig(root: string, configPath: string) {
  return configPath.slice(root.length + 1).replaceAll("\\", "/");
}

function workspaceRelativePath(root: string, path: string) {
  const workspacePath = relative(root, path).replaceAll("\\", "/");
  if (
    !workspacePath ||
    workspacePath === ".." ||
    workspacePath.startsWith("../")
  )
    return undefined;
  return workspacePath;
}

function refreshCachedProject(key: string, project: CachedProject) {
  projectCache.delete(key);
  projectCache.set(key, project);
  return project;
}

function trimProjectCache() {
  while (projectCache.size > maximumCachedProjects) {
    const oldest = projectCache.entries().next().value;
    if (!oldest) return;
    oldest[1].service.dispose();
    projectCache.delete(oldest[0]);
  }
}

function isTypeScriptProjectFile(path: string) {
  return /\.(?:[cm]?[jt]sx?|d\.ts)$/iu.test(path);
}

const inferredCompilerOptions: ts.CompilerOptions = {
  allowJs: true,
  checkJs: false,
  jsx: ts.JsxEmit.Preserve,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ESNext,
};

type ProjectConfiguration = {
  configured: boolean;
  files: string[];
  options: ts.CompilerOptions;
};
