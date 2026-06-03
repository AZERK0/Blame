import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  projectCreationRecipe,
  validateProjectTarget,
  type NewProjectConfiguration,
} from "./project-creation.ts";

const baseConfiguration: NewProjectConfiguration = {
  platform: "web",
  frontend: "next",
  styling: "tailwind",
  uiLibrary: "shadcn",
  backend: "next-api",
  database: "postgresql",
  orm: "prisma",
  packageManager: "pnpm",
  codeQuality: "eslint-prettier",
  advancedOptions: ["envExample", "readme", "blamePreview"],
};

test("rejects path traversal project names", async () => {
  const parent = await mkdtemp(join(tmpdir(), "blame-new-project-"));

  await assert.rejects(
    () => validateProjectTarget(parent, "../escape"),
    /letters, numbers/
  );
});

test("rejects non-empty target directories", async () => {
  const parent = await mkdtemp(join(tmpdir(), "blame-new-project-"));
  const target = join(parent, "taken");
  await mkdir(target);
  await writeFile(join(target, "README.md"), "taken", "utf8");

  await assert.rejects(
    () => validateProjectTarget(parent, "taken"),
    /not empty/
  );
});

test("accepts valid parent and project name", async () => {
  const parent = await mkdtemp(join(tmpdir(), "blame-new-project-"));
  const target = await validateProjectTarget(parent, "valid-app");

  assert.equal(target, join(parent, "valid-app"));
});

test("builds Next.js recipe with selected package manager and overlays", () => {
  const recipe = projectCreationRecipe(
    { ...baseConfiguration, packageManager: "npm" },
    "/tmp/my-app"
  );

  assert.equal(recipe.scaffold.command, "npm");
  assert.deepEqual(recipe.scaffold.args.slice(0, 3), [
    "create",
    "next-app@latest",
    "my-app",
  ]);
  assert.equal(recipe.installs[0]?.command, "npm");
  assert.equal(
    recipe.overlays.some((overlay) => overlay.path.endsWith(".blame/preview.json")),
    true
  );
});

test("scaffolds uppercase project names with npm-safe directory names", () => {
  const recipe = projectCreationRecipe(baseConfiguration, "/tmp/BlameTest");

  assert.equal(recipe.scaffoldTarget, "/tmp/blame-test");
  assert.deepEqual(recipe.scaffold.args.slice(0, 3), [
    "create",
    "next-app",
    "blame-test",
  ]);
});

test("builds Vite recipe for React templates", () => {
  const recipe = projectCreationRecipe(
    { ...baseConfiguration, frontend: "react-vite", backend: "hono" },
    "/tmp/react-app"
  );

  assert.equal(recipe.scaffold.command, "pnpm");
  assert.deepEqual(recipe.scaffold.args, [
    "create",
    "vite",
    "react-app",
    "--template",
    "react-ts",
  ]);
});

test("maps advanced options to generated files", () => {
  const recipe = projectCreationRecipe(
    {
      ...baseConfiguration,
      advancedOptions: ["docker", "dockerCompose", "githubActions"],
    },
    "/tmp/full-app"
  );

  assert.deepEqual(
    recipe.overlays.map((overlay) => overlay.path).sort(),
    [
      "/tmp/full-app/.github/workflows/ci.yml",
      "/tmp/full-app/Dockerfile",
      "/tmp/full-app/docker-compose.yml",
    ]
  );
});
