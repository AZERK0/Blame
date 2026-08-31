import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PreviewManifest } from "@blame/preview-contract";
import { preflightDeploySource } from "./deploy-source.ts";

test("builds a deterministic preflight while hard-excluding local secrets", async () => {
  const root = await repository();
  try {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ devDependencies: { vite: "latest" } }),
    );
    await writeFile(join(root, ".env"), "SECRET=do-not-upload");
    await writeFile(join(root, ".env.example"), "SECRET=");
    await writeFile(join(root, ".vercelignore"), "ignored.txt\n");
    await writeFile(join(root, "ignored.txt"), "ignored");
    const result = await preflightDeploySource(input(root));
    const repeated = await preflightDeploySource(input(root));
    assert.equal(result.manifest.framework, "vite");
    assert.equal(result.manifest.compatibility.status, "supported");
    assert.equal(result.snapshot.fileCount, 3);
    assert.equal(result.excludedFileCount, 2);
    assert.equal(
      result.snapshot.workspaceHash,
      repeated.snapshot.workspaceHash,
    );
    assert.equal(
      result.snapshot.manifestHash,
      createHash("sha256")
        .update(JSON.stringify(result.manifest))
        .digest("hex"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("blocks a high-confidence secret without returning its path or value", async () => {
  const root = await repository();
  try {
    const secret = "AKIAABCDEFGHIJKLMNOP";
    await writeFile(join(root, "index.html"), `<p>${secret}</p>`);
    const result = await preflightDeploySource(input(root));
    assert.equal(result.manifest.compatibility.status, "unsupported");
    assert.equal(
      result.manifest.compatibility.blockers[0]?.code,
      "DEPLOY_SECRET_DETECTED",
    );
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
    assert.doesNotMatch(JSON.stringify(result), /index\.html/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("gives repository Vercel settings priority over framework detection", async () => {
  const root = await repository();
  try {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ devDependencies: { vite: "latest" } }),
    );
    await writeFile(
      join(root, "vercel.json"),
      JSON.stringify({
        framework: "nextjs",
        buildCommand: "pnpm build",
        outputDirectory: "dist",
      }),
    );
    const result = await preflightDeploySource(input(root));
    assert.equal(result.manifest.framework, "nextjs");
    assert.equal(result.manifest.buildCommand, "pnpm build");
    assert.equal(result.manifest.outputDirectory, "dist");
    assert.equal(result.manifest.compatibility.status, "conditional");
    assert.equal(
      result.manifest.compatibility.warnings[0]?.code,
      "DEPLOY_REPOSITORY_CONFIG_PREVAILS",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("blocks case-insensitive path collisions before upload", async (context) => {
  const root = await repository();
  try {
    await writeFile(join(root, "README.md"), "one");
    await writeFile(join(root, "readme.md"), "two");
    if (
      (await readdir(root)).filter((name) => name.toLowerCase() === "readme.md")
        .length < 2
    ) {
      context.skip("The host filesystem is case-insensitive");
      return;
    }
    const result = await preflightDeploySource(input(root));
    assert.equal(result.manifest.compatibility.status, "unsupported");
    assert.equal(
      result.manifest.compatibility.blockers[0]?.code,
      "DEPLOY_CASE_COLLISION",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function repository() {
  const root = await mkdtemp(join(tmpdir(), "blame-deploy-source-"));
  execFileSync("git", ["init", root]);
  return root;
}

function input(root: string) {
  return {
    root,
    previewManifest: manifest(),
    runConfigurations: [
      {
        id: "web",
        command: "pnpm dev",
        cwd: ".",
        default: true,
        category: "web" as const,
        services: ["web"],
        previewService: "web",
        scopes: ["."],
      },
    ],
  };
}

function manifest(): PreviewManifest {
  return {
    confidence: "high",
    project: { root: "." },
    setup: [],
    services: [
      {
        id: "web",
        kind: "preview",
        container: { image: "node:24" },
        command: "pnpm dev",
        endpoints: [{ id: "http", protocol: "http", port: 5173 }],
      },
    ],
    caches: [],
    risks: [],
    probes: [],
  };
}
