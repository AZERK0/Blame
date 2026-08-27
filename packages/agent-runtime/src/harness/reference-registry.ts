import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { lock } from "proper-lockfile";
import writeFileAtomic from "write-file-atomic";
import { recalculateHarnessUsage, sha256 } from "./protocol.js";

type ReferenceScheme = "file" | "match" | "node" | "sym";

type ReferenceEntry = {
  label?: string;
  reference: string;
  scheme: ReferenceScheme;
};

type RegistryFile = {
  counters: Record<ReferenceScheme, number>;
  entries: Record<string, ReferenceEntry>;
  schema_version: "1.0";
};

type ReferenceCandidate = {
  label?: string;
  reference: string;
  scheme: ReferenceScheme;
};

const referenceFields = new Set([
  "file_ref",
  "match_ref",
  "node_ref",
  "ref",
  "reference",
  "symbolRef",
  "symbol_ref",
  "target",
]);

export class ReferenceRegistry {
  private readonly lockDirectory: string;
  private readonly path: string;

  constructor(workspaceRoot: string, sessionId: string) {
    const root = join(workspaceRoot, ".blame", "harness", "references");
    const identity = sha256(sessionId);
    this.path = join(root, `${identity}.json`);
    this.lockDirectory = join(root, `${identity}.lock`);
  }

  async shorten<T>(value: T): Promise<T> {
    const candidates = collectFullReferences(value);
    if (!candidates.length) return value;
    const replacements = await this.register(candidates);
    return recalculateHarnessUsage(replaceReferences(value, replacements));
  }

  async expand<T>(value: T): Promise<T> {
    const references = collectShortReferences(value);
    if (!references.length) return value;
    const replacements = await this.resolve(references);
    return replaceReferences(value, replacements);
  }

  private register(candidates: ReferenceCandidate[]) {
    return this.exclusive(async () => {
      const registry = await this.read();
      const replacements = new Map<string, string>();
      let changed = false;
      for (const candidate of uniqueCandidates(candidates)) {
        const existing = existingHandle(registry, candidate.reference);
        const handle = existing ?? nextHandle(registry, candidate.scheme);
        replacements.set(candidate.reference, handle);
        if (existing) continue;
        registry.entries[handle] = candidate;
        changed = true;
      }
      if (changed) await this.write(registry);
      return replacements;
    });
  }

  private resolve(references: string[]) {
    return this.exclusive(async () => {
      const registry = await this.read();
      const replacements = new Map<string, string>();
      for (const handle of new Set(references)) {
        const entry = registry.entries[handle];
        if (!entry)
          throw new Error(
            `INVALID_INPUT:Reference ${handle} is unavailable in this session. Repeat the narrow semantic read to obtain a current reference.`,
          );
        replacements.set(handle, entry.reference);
      }
      return replacements;
    });
  }

  private async exclusive<T>(operation: () => Promise<T>) {
    await mkdir(this.lockDirectory, { recursive: true, mode: 0o700 });
    const release = await lock(this.lockDirectory, {
      realpath: false,
      retries: { retries: 40, factor: 1.2, minTimeout: 10, maxTimeout: 500 },
      stale: 30_000,
    });
    try {
      return await operation();
    } finally {
      await release();
    }
  }

  private async read(): Promise<RegistryFile> {
    try {
      const value = JSON.parse(
        await readFile(this.path, "utf8"),
      ) as RegistryFile;
      if (value.schema_version !== "1.0" || !value.entries || !value.counters)
        throw new Error("Reference registry schema is unsupported.");
      return value;
    } catch (error) {
      if (errorCode(error) === "ENOENT") return emptyRegistry();
      throw error;
    }
  }

  private async write(registry: RegistryFile) {
    await mkdir(join(this.path, ".."), { recursive: true, mode: 0o700 });
    await writeFileAtomic(this.path, JSON.stringify(registry), {
      fsync: true,
      mode: 0o600,
    });
  }
}

function emptyRegistry(): RegistryFile {
  return {
    counters: { file: 0, match: 0, node: 0, sym: 0 },
    entries: {},
    schema_version: "1.0",
  };
}

function collectFullReferences(value: unknown) {
  const candidates: ReferenceCandidate[] = [];
  visitReferences(value, (reference, label) => {
    const scheme = fullReferenceScheme(reference);
    if (scheme)
      candidates.push({ reference, scheme, ...(label ? { label } : {}) });
  });
  return candidates;
}

function collectShortReferences(value: unknown) {
  const references: string[] = [];
  visitReferences(value, (reference) => {
    if (shortReferenceScheme(reference)) references.push(reference);
  });
  return references;
}

function visitReferences(
  value: unknown,
  visitor: (reference: string, label?: string) => void,
  field?: string,
  label?: string,
) {
  if (typeof value === "string") {
    if (isReferenceField(field)) visitor(value, label);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) visitReferences(item, visitor, field, label);
    return;
  }
  if (!isRecord(value)) return;
  const nextLabel = referenceLabel(value) ?? label;
  for (const [key, item] of Object.entries(value))
    visitReferences(item, visitor, key, nextLabel);
}

function replaceReferences<T>(value: T, replacements: Map<string, string>): T {
  return replaceReferenceValue(value, replacements) as T;
}

function replaceReferenceValue(
  value: unknown,
  replacements: Map<string, string>,
  field?: string,
): unknown {
  if (typeof value === "string")
    return isReferenceField(field) ? (replacements.get(value) ?? value) : value;
  if (Array.isArray(value))
    return value.map((item) =>
      replaceReferenceValue(item, replacements, field),
    );
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      replaceReferenceValue(item, replacements, key),
    ]),
  );
}

function isReferenceField(field?: string) {
  return Boolean(
    field && (referenceFields.has(field) || field.endsWith("_refs")),
  );
}

function fullReferenceScheme(value: string): ReferenceScheme | undefined {
  for (const scheme of ["file", "match", "node", "sym"] as const)
    if (value.startsWith(`${scheme}://`)) return scheme;
  return undefined;
}

function shortReferenceScheme(value: string): ReferenceScheme | undefined {
  const prefix = value.match(/^([fmns])_[a-z0-9]{2,10}$/u)?.[1];
  if (prefix === "f") return "file";
  if (prefix === "m") return "match";
  if (prefix === "n") return "node";
  if (prefix === "s") return "sym";
  return undefined;
}

function existingHandle(registry: RegistryFile, reference: string) {
  return Object.entries(registry.entries).find(
    ([, entry]) => entry.reference === reference,
  )?.[0];
}

function nextHandle(registry: RegistryFile, scheme: ReferenceScheme) {
  registry.counters[scheme] += 1;
  const prefix = { file: "f", match: "m", node: "n", sym: "s" }[scheme];
  return `${prefix}_${registry.counters[scheme].toString(36).padStart(2, "0")}`;
}

function uniqueCandidates(candidates: ReferenceCandidate[]) {
  return [
    ...new Map(candidates.map((item) => [item.reference, item])).values(),
  ];
}

function referenceLabel(value: Record<string, unknown>) {
  const path = stringValue(value.path);
  const symbol = stringValue(value.qualified_name) ?? stringValue(value.name);
  if (path && symbol) return `${path}:${symbol}`;
  if (path) return path;
  return symbol;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
