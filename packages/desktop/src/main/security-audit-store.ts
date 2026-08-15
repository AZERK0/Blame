import type {
  SecurityAudit,
  SecurityFindingStatus,
} from "@blame/agent-runtime";
import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";

type CreateAuditInput = Pick<
  SecurityAudit,
  "analysisModel" | "mode" | "projectId" | "scope"
>;
type FindingUpdate = {
  backlogStoryId?: string;
  status?: SecurityFindingStatus;
};

const activeStatuses = new Set<SecurityAudit["status"]>([
  "queued",
  "mapping",
  "discovery",
  "validation",
  "prioritization",
]);

export class SecurityAuditStore {
  async list(root: string) {
    const directory = auditsDirectory(root);
    let entries: Dirent<string>[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }
    const audits = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && safeAuditId(entry.name))
        .map((entry) => this.read(root, entry.name).catch(() => undefined)),
    );
    return audits
      .filter((audit): audit is SecurityAudit => Boolean(audit))
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  async read(root: string, auditId: string): Promise<SecurityAudit> {
    const directory = auditDirectory(root, auditId);
    const [manifest, threatModel, coverage, findings] = await Promise.all([
      readJson(join(directory, "manifest.json")),
      readOptionalJson(join(directory, "threat-model.json")),
      readOptionalJson(join(directory, "coverage.json")),
      readOptionalJson(join(directory, "findings.json")),
    ]);
    const audit = record(manifest);
    if (audit.id !== auditId || audit.version !== 1) {
      throw new Error("Stored security audit manifest is invalid");
    }
    return {
      ...audit,
      ...(threatModel ? { threatModel } : {}),
      ...(coverage ? { coverage } : {}),
      findings: Array.isArray(findings) ? findings : [],
    } as SecurityAudit;
  }

  async create(root: string, input: CreateAuditInput) {
    await assertProjectRoot(root);
    const timestamp = new Date().toISOString();
    const audit: SecurityAudit = {
      version: 1,
      id: randomUUID(),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.analysisModel ? { analysisModel: input.analysisModel } : {}),
      mode: input.mode,
      scope: input.scope,
      status: "queued",
      findings: [],
      candidateCount: 0,
      rejectedCandidateCount: 0,
      sessionIds: [],
      scannerVersions: {
        "blame-security-engine": "1",
        "ai-static-review": "1",
        "local-secret-scanner": "1",
        "threat-model": "1",
      },
      startedAt: timestamp,
      updatedAt: timestamp,
    };
    await this.write(root, audit);
    return audit;
  }

  async write(root: string, audit: SecurityAudit) {
    const directory = auditDirectory(root, audit.id);
    await mkdir(directory, { recursive: true });
    const { threatModel, coverage, findings, ...manifest } = audit;
    await Promise.all([
      atomicJson(join(directory, "manifest.json"), manifest),
      threatModel
        ? atomicJson(join(directory, "threat-model.json"), threatModel)
        : Promise.resolve(),
      coverage
        ? atomicJson(join(directory, "coverage.json"), coverage)
        : Promise.resolve(),
      atomicJson(join(directory, "findings.json"), findings),
    ]);
    return audit;
  }

  async update(root: string, auditId: string, update: Partial<SecurityAudit>) {
    const current = await this.read(root, auditId);
    return this.write(root, {
      ...current,
      ...update,
      id: current.id,
      version: 1,
      updatedAt: new Date().toISOString(),
    });
  }

  async updateFinding(
    root: string,
    auditId: string,
    fingerprint: string,
    update: FindingUpdate,
  ) {
    const current = await this.read(root, auditId);
    let found = false;
    const findings = current.findings.map((finding) => {
      if (finding.fingerprint !== fingerprint) return finding;
      found = true;
      return { ...finding, ...update };
    });
    if (!found) throw new Error("Security finding was not found");
    return this.write(root, {
      ...current,
      findings,
      updatedAt: new Date().toISOString(),
    });
  }

  async failInterrupted(root: string) {
    const audits = await this.list(root);
    return Promise.all(
      audits.map((audit) =>
        activeStatuses.has(audit.status)
          ? this.update(root, audit.id, {
              status: "failed",
              error: "The audit was interrupted before it completed.",
              completedAt: new Date().toISOString(),
            })
          : audit,
      ),
    );
  }
}

function auditsDirectory(root: string) {
  return join(projectRoot(root), ".blame", "security", "audits");
}

function auditDirectory(root: string, auditId: string) {
  if (!safeAuditId(auditId)) throw new Error("Security audit id is invalid");
  return join(auditsDirectory(root), auditId);
}

function projectRoot(root: string) {
  if (!root || !isAbsolute(root))
    throw new Error("Project root must be absolute");
  const resolved = resolve(root);
  if (resolved === sep) throw new Error("Project root is too broad");
  return resolved;
}

async function assertProjectRoot(root: string) {
  const info = await stat(projectRoot(root));
  if (!info.isDirectory()) throw new Error("Project root is not a directory");
}

function safeAuditId(value: string) {
  return /^[a-zA-Z0-9_-]{8,80}$/.test(value);
}

async function atomicJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, path);
}

async function readJson(path: string) {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function readOptionalJson(path: string) {
  try {
    return await readJson(path);
  } catch {
    return undefined;
  }
}

function record(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Stored security audit is invalid");
  }
  return value as Record<string, unknown>;
}
