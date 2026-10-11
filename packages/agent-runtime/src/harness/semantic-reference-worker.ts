// Read-only compiler service in a bounded worker. No plugins, emit or processes.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import ts from "typescript";
import { compilerRenamePlan } from "./semantic-rename-plan.js";
import {
  semanticReferenceLimits as limits,
  type SemanticReferenceReply,
  type SemanticReferenceRequest,
} from "./semantic-reference-types.js";

const request = workerData as SemanticReferenceRequest;
const root = resolve(request.root);
const reads = new Map<string, { text: string; hash: string }>();
const existence = new Map<string, boolean>();
let observedBytes = 0;
const local = (path: string) => {
  const value = relative(root, path);
  return (
    value !== ".." &&
    !value.startsWith("../") &&
    !value.startsWith("..\\") &&
    !isAbsolute(value)
  );
};
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const host: ts.ParseConfigFileHost = {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: () => {},
  readFile(path) {
    const key = resolve(path);
    const cached = reads.get(key);
    if (cached) return cached.text;
    let text: string | undefined;
    try {
      text = readFileSync(key, "utf8");
    } catch {
      host.fileExists(key);
      return undefined;
    }
    if (text === undefined) return undefined;
    observedBytes += Buffer.byteLength(text);
    if (
      reads.size >= limits.observedFiles ||
      observedBytes > limits.observedBytes
    )
      throw new Error("project_read_budget_exceeded");
    reads.set(key, { text, hash: digest(text) });
    return text;
  },
  fileExists(path) {
    const key = resolve(path);
    if (existence.has(key)) return existence.get(key)!;
    if (existence.size >= limits.observedExistence)
      throw new Error("project_lookup_budget_exceeded");
    const exists = ts.sys.fileExists(key);
    existence.set(key, exists);
    return exists;
  },
};

function configPath(target: string) {
  let directory = dirname(target);
  while (local(directory)) {
    for (const name of ["tsconfig.json", "jsconfig.json"]) {
      const path = resolve(directory, name);
      if (host.fileExists(path)) return path;
    }
    if (directory === root) break;
    directory = dirname(directory);
  }
  return undefined;
}

function query(): SemanticReferenceReply {
  const targetPath = resolve(root, request.target.path);
  if (!local(targetPath))
    return { status: "unavailable", reason: "target_outside_workspace" };
  const config = configPath(targetPath);
  if (!config) return { status: "unavailable", reason: "no_project_config" };
  const parsed = ts.getParsedCommandLineOfConfigFile(config, {}, host);
  if (!parsed || parsed.errors.length)
    return { status: "unavailable", reason: "invalid_project_config" };
  if (parsed.fileNames.length > limits.rootFiles)
    return { status: "unavailable", reason: "project_file_budget_exceeded" };
  if (parsed.fileNames.some((path) => !local(path)))
    return { status: "unavailable", reason: "project_roots_outside_workspace" };
  const text = host.readFile(targetPath);
  if (text === undefined || digest(text) !== request.target.hash)
    return { status: "unavailable", reason: "source_changed" };
  const overlay = new Map<string, string>();
  let projectVersion = 0;
  const scriptHost: ts.LanguageServiceHost = {
    ...host,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    readDirectory: (...args) => [...ts.sys.readDirectory(...args)],
    getCompilationSettings: () => parsed.options,
    getScriptFileNames: () => parsed.fileNames,
    getScriptVersion: (path) => (overlay.has(resolve(path)) ? "1" : "0"),
    getProjectVersion: () => String(projectVersion),
    getScriptSnapshot: (path) => {
      const source = overlay.get(resolve(path)) ?? host.readFile(path);
      return source === undefined
        ? undefined
        : ts.ScriptSnapshot.fromString(source);
    },
    getCurrentDirectory: () => dirname(config),
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    getProjectReferences: () => parsed.projectReferences,
  };
  const service = ts.createLanguageService(scriptHost);
  try {
    const program = service.getProgram();
    const source = program?.getSourceFile(targetPath);
    if (!source)
      return { status: "unavailable", reason: "target_not_in_project" };
    const start = Buffer.from(text)
      .subarray(0, request.target.start)
      .toString("utf8").length;
    const end = Buffer.from(text)
      .subarray(0, request.target.end)
      .toString("utf8").length;
    const names: ts.Identifier[] = [];
    const leaf = request.target.name.split(/[./]/u).at(-1);
    function visit(node: ts.Node) {
      if (node.getEnd() < start || node.getStart(source) > end) return;
      const named = node as ts.NamedDeclaration;
      if (
        named.name &&
        ts.isIdentifier(named.name) &&
        named.name.text === leaf &&
        named.name.getStart(source) >= start &&
        named.name.getEnd() <= end
      )
        names.push(named.name);
      ts.forEachChild(node, visit);
    }
    visit(source);
    names.sort((a, b) => a.getStart(source) - b.getStart(source));
    const name = names[0];
    if (!name)
      return {
        status: "unavailable",
        reason: "unsupported_target_declaration",
      };
    const position = name.getStart(source);
    const references = service.getReferencesAtPosition(targetPath, position);
    if (!references)
      return { status: "unavailable", reason: "unresolved_target" };
    if (references.length > limits.locations)
      return { status: "unavailable", reason: "reference_budget_exceeded" };
    let locations = references.flatMap((entry) => {
      if (
        !local(entry.fileName) ||
        entry.fileName.split(/[\\/]/u).includes("node_modules")
      )
        return [];
      if (
        resolve(entry.fileName) === targetPath &&
        entry.textSpan.start === position
      )
        return [];
      const content = host.readFile(entry.fileName);
      if (content === undefined)
        throw new Error("reference_source_unavailable");
      const from = entry.textSpan.start,
        to = from + entry.textSpan.length;
      const first = content.lastIndexOf("\n", from - 1) + 1;
      const next = content.indexOf("\n", to);
      const line = content.slice(0, from).split("\n").length;
      return [
        {
          path: relative(root, entry.fileName).split("\\").join("/"),
          range: [
            Buffer.byteLength(content.slice(0, from)),
            Buffer.byteLength(content.slice(0, to)),
          ] as [number, number],
          lines: [
            line,
            line + content.slice(from, to).split("\n").length - 1,
          ] as [number, number],
          snippet: content
            .slice(first, next < 0 ? content.length : next)
            .trim()
            .slice(0, 400),
          isWrite: entry.isWriteAccess,
        },
      ];
    });
    const warnings: string[] = [];
    if (parsed.projectReferences?.length)
      warnings.push("project_references_not_fully_expanded");
    if (
      program?.getOptionsDiagnostics().length ||
      program?.getGlobalDiagnostics().length
    )
      warnings.push("compiler_project_diagnostics");
    let unresolved = false;
    const ambientModules = new Set(
      program
        ?.getTypeChecker()
        .getAmbientModules()
        .map((symbol) => symbol.name.replace(/^"|"$/gu, "")),
    );
    for (const file of program?.getSourceFiles() ?? []) {
      if (!local(file.fileName) || file.isDeclarationFile) continue;
      for (const imported of ts.preProcessFile(file.text).importedFiles)
        if (
          !ambientModules.has(imported.fileName) &&
          !ts.resolveModuleName(
            imported.fileName,
            file.fileName,
            parsed.options,
            host,
          ).resolvedModule
        )
          unresolved = true;
    }
    if (unresolved) warnings.push("unresolved_imports");
    if (request.renameTo !== undefined) {
      const shadowExtensions = targetPath.endsWith(".cjs")
        ? [".cts"]
        : targetPath.endsWith(".mjs")
          ? [".mts"]
          : targetPath.endsWith(".jsx")
            ? [".tsx"]
            : targetPath.endsWith(".js")
              ? [".ts", ".tsx"]
              : [];
      if (
        shadowExtensions.some((extension) =>
          host.fileExists(targetPath.replace(/\.[^.]+$/u, extension)),
        )
      )
        throw new Error("ambiguous_js_ts_source_shadow");
      if (warnings.length)
        throw new Error(`incomplete_rename_project: ${warnings.join(",")}`);
      const renamed = compilerRenamePlan(
        service,
        program!,
        targetPath,
        position,
        name.text,
        request.renameTo,
        host.readFile,
        (path) => local(path) && !path.split(/[\\/]/u).includes("node_modules"),
        (changed) => {
          for (const [path, text] of changed) overlay.set(resolve(path), text);
          projectVersion++;
        },
      );
      locations = renamed.map((entry) => {
        const content = host.readFile(entry.fileName)!;
        const from = entry.textSpan.start,
          to = from + entry.textSpan.length;
        const line = content.slice(0, from).split("\n").length;
        return {
          path: relative(root, entry.fileName).split("\\").join("/"),
          range: [
            Buffer.byteLength(content.slice(0, from)),
            Buffer.byteLength(content.slice(0, to)),
          ],
          lines: [line, line],
          snippet: content.slice(from, to),
          isWrite: true,
          replacement:
            (entry.prefixText ?? "") +
            request.renameTo! +
            (entry.suffixText ?? ""),
        };
      });
    }
    return {
      status: "ok",
      locations,
      footprint: {
        reads: [...reads].map(([path, value]) => ({ path, hash: value.hash })),
        existence: [...existence].map(([path, exists]) => ({ path, exists })),
      },
      project: {
        config: relative(root, config).split("\\").join("/"),
        rootFiles: parsed.fileNames.length,
        loadedFiles: program?.getSourceFiles().length ?? 0,
        compilerVersion: ts.version,
        scope: "configured_project",
        warnings,
      },
    };
  } finally {
    service.dispose();
  }
}

try {
  parentPort?.postMessage(query());
} catch (error) {
  parentPort?.postMessage({
    status: "unavailable",
    reason:
      error instanceof Error ? error.message.slice(0, 240) : "compiler_error",
  });
}
