import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { projectSetupRecipe } from "./project-setup-recipes.ts";

export type ProjectPlatform =
  | "web"
  | "backend"
  | "desktop"
  | "mobile"
  | "cli"
  | "package";

export type FrontendFramework =
  | "next"
  | "react-vite"
  | "nuxt"
  | "vue-vite"
  | "sveltekit"
  | "none";

export type StylingOption =
  | "tailwind"
  | "css-modules"
  | "sass"
  | "vanilla-css"
  | "none";

export type UiLibrary =
  | "shadcn"
  | "radix"
  | "mantine"
  | "mui"
  | "ant-design"
  | "daisyui"
  | "nuxt-ui"
  | "primevue"
  | "vuetify"
  | "naive-ui"
  | "shadcn-svelte"
  | "skeleton"
  | "melt-ui"
  | "flowbite-svelte"
  | "none";

export type BackendFramework =
  | "next-api"
  | "nest"
  | "hono"
  | "fastify"
  | "fastapi"
  | "nitro"
  | "none";

export type DatabaseOption =
  | "postgresql"
  | "mysql"
  | "sqlite"
  | "mongodb"
  | "none";

export type OrmOption =
  | "prisma"
  | "drizzle"
  | "kysely"
  | "sqlalchemy"
  | "sqlmodel"
  | "none";

export type PackageManager =
  | "pnpm"
  | "npm"
  | "yarn"
  | "bun"
  | "uv"
  | "poetry"
  | "pip";

export type CodeQualityOption =
  | "biome"
  | "eslint-prettier"
  | "eslint"
  | "prettier"
  | "none";

export type AdvancedProjectOption =
  | "docker"
  | "dockerCompose"
  | "monorepo"
  | "auth"
  | "unitTests"
  | "e2eTests"
  | "githubActions"
  | "envExample"
  | "readme"
  | "typescriptAlias"
  | "standardScripts"
  | "blamePreview";

export type NewProjectConfiguration = {
  platform: ProjectPlatform;
  frontend: FrontendFramework;
  styling: StylingOption;
  uiLibrary: UiLibrary;
  backend: BackendFramework;
  database: DatabaseOption;
  orm: OrmOption;
  packageManager: PackageManager;
  codeQuality: CodeQualityOption;
  advancedOptions: AdvancedProjectOption[];
};

export type CreateProjectInput = {
  configuration: NewProjectConfiguration;
  parentPath: string;
  projectName: string;
  runId: string;
};

export type CommandRecipe = {
  command: string;
  args: string[];
  cwd: string;
};

export type ProjectCreationRecipe = {
  scaffold: CommandRecipe;
  scaffoldTarget: string;
  installs: CommandRecipe[];
  overlays: Array<{ path: string; content: string }>;
};

type ProjectCreationEvent = {
  type: "stdout" | "stderr" | "exit";
  data: string;
};

type ProjectCreationWindow = {
  webContents: {
    send(channel: string, event: ProjectCreationEvent): void;
  };
};

let projectCreationWindowsProvider = () => [] as ProjectCreationWindow[];

export function setProjectCreationWindowsProvider(
  provider: () => ProjectCreationWindow[]
) {
  projectCreationWindowsProvider = provider;
}

export async function createProject(input: CreateProjectInput) {
  const target = await validateProjectTarget(input.parentPath, input.projectName);
  const recipe = projectCreationRecipe(input.configuration, target);
  const emit = projectCreationEmitter(input.runId);

  emit({ type: "stdout", data: `Creating ${basename(target)}...\n` });
  await runCommand(recipe.scaffold, emit);
  await renameScaffoldTarget(recipe.scaffoldTarget, target);
  await applyProjectOverlays(target, recipe.overlays);

  for (const install of recipe.installs) {
    await runCommand(install, emit);
  }

  const setupRecipe = projectSetupRecipe(input.configuration);
  emit({ type: "exit", data: "0" });
  return {
    dockerCompose: setupRecipe.dockerCompose,
    path: target,
    setupScript: setupRecipe.setupScript,
  };
}

export async function validateProjectTarget(
  parentPath: string,
  projectName: string
) {
  const name = projectName.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
    throw new Error("Project name can contain letters, numbers, dots, dashes and underscores.");
  }

  const parent = resolve(parentPath);
  const target = resolve(parent, name);
  const pathInsideParent = relative(parent, target);
  if (!pathInsideParent || pathInsideParent.startsWith("..")) {
    throw new Error("Project path must stay inside the selected parent folder.");
  }

  if (existsSync(target) && (await readdir(target)).length > 0) {
    throw new Error("Project directory already exists and is not empty.");
  }

  await mkdir(parent, { recursive: true });
  return target;
}

export function projectCreationRecipe(
  configuration: NewProjectConfiguration,
  target: string
): ProjectCreationRecipe {
  if (configuration.platform !== "web") {
    throw new Error("Only web applications are supported in this version.");
  }

  if (configuration.frontend === "none") {
    throw new Error("A frontend framework is required for the first web generator.");
  }

  const scaffold = scaffoldCommand(configuration, target);
  const scaffoldTarget = resolve(scaffold.cwd, scaffoldProjectName(target));
  const installs = installCommands(configuration, target);
  const overlays = projectOverlays(configuration, target);
  return { scaffold, scaffoldTarget, installs, overlays };
}

function scaffoldCommand(
  configuration: NewProjectConfiguration,
  target: string
): CommandRecipe {
  const name = basename(target);
  const scaffoldName = scaffoldProjectName(target);
  const parent = resolve(target, "..");
  const pm = nodePackageManager(configuration.packageManager);

  if (configuration.frontend === "next") {
    return {
      command: pm,
      args: [
        ...createArgs(pm, "next-app"),
        scaffoldName,
        "--ts",
        "--app",
        "--src-dir",
        configuration.styling === "tailwind" ? "--tailwind" : "--no-tailwind",
        ...nextQualityArgs(configuration.codeQuality),
        "--import-alias",
        "@/*",
        ...nextPackageManagerArgs(pm),
        "--skip-install",
        "--disable-git",
        "--yes",
      ],
      cwd: parent,
    };
  }

  if (configuration.frontend === "react-vite") {
    return viteCommand(pm, parent, scaffoldName, "react-ts");
  }

  if (configuration.frontend === "vue-vite") {
    return viteCommand(pm, parent, scaffoldName, "vue-ts");
  }

  if (configuration.frontend === "nuxt") {
    return {
      command: pm,
      args: [...createArgs(pm, "nuxt"), scaffoldName],
      cwd: parent,
    };
  }

  return {
    command: pm === "npm" ? "npx" : pm,
    args:
      pm === "npm"
        ? ["sv", "create", scaffoldName, "--template", "minimal", "--types", "ts", "--no-add-ons", "--no-install"]
        : ["dlx", "sv", "create", scaffoldName, "--template", "minimal", "--types", "ts", "--no-add-ons", "--no-install"],
    cwd: parent,
  };
}

function viteCommand(
  packageManager: string,
  parent: string,
  name: string,
  template: string
): CommandRecipe {
  return {
    command: packageManager,
    args: [...createArgs(packageManager, "vite"), name, "--template", template],
    cwd: parent,
  };
}

function installCommands(
  configuration: NewProjectConfiguration,
  target: string
): CommandRecipe[] {
  const packageManager = nodePackageManager(configuration.packageManager);
  const packages = additionalPackages(configuration);
  const commands = [installCommand(packageManager, target)];

  if (packages.dependencies.length > 0) {
    commands.push(addCommand(packageManager, target, packages.dependencies, false));
  }

  if (packages.devDependencies.length > 0) {
    commands.push(addCommand(packageManager, target, packages.devDependencies, true));
  }

  return commands;
}

function additionalPackages(configuration: NewProjectConfiguration) {
  const dependencies = new Set<string>();
  const devDependencies = new Set<string>();

  addUiPackages(configuration.uiLibrary, dependencies, devDependencies);
  addBackendPackages(configuration.backend, dependencies, devDependencies);
  addDataPackages(configuration.database, configuration.orm, dependencies, devDependencies);
  addQualityPackages(configuration.codeQuality, devDependencies);
  addAdvancedPackages(configuration.advancedOptions, devDependencies);

  if (configuration.styling === "sass") devDependencies.add("sass");
  if (configuration.styling === "tailwind" && configuration.frontend !== "next") {
    devDependencies.add("tailwindcss");
    devDependencies.add("@tailwindcss/vite");
  }

  return {
    dependencies: [...dependencies],
    devDependencies: [...devDependencies],
  };
}

function addUiPackages(
  uiLibrary: UiLibrary,
  dependencies: Set<string>,
  devDependencies: Set<string>
) {
  const dependencyMap: Partial<Record<UiLibrary, string[]>> = {
    radix: ["radix-ui"],
    mantine: ["@mantine/core", "@mantine/hooks"],
    mui: ["@mui/material", "@emotion/react", "@emotion/styled"],
    "ant-design": ["antd"],
    daisyui: ["daisyui"],
    "nuxt-ui": ["@nuxt/ui"],
    primevue: ["primevue"],
    vuetify: ["vuetify"],
    "naive-ui": ["naive-ui"],
    skeleton: ["@skeletonlabs/skeleton"],
    "melt-ui": ["@melt-ui/svelte"],
    "flowbite-svelte": ["flowbite-svelte", "flowbite"],
  };

  for (const name of dependencyMap[uiLibrary] ?? []) dependencies.add(name);
  if (uiLibrary === "shadcn" || uiLibrary === "shadcn-svelte") {
    devDependencies.add(uiLibrary === "shadcn" ? "shadcn" : "shadcn-svelte");
  }
}

function addBackendPackages(
  backend: BackendFramework,
  dependencies: Set<string>,
  devDependencies: Set<string>
) {
  if (backend === "hono") dependencies.add("hono");
  if (backend === "fastify") dependencies.add("fastify");
  if (backend === "nest") {
    dependencies.add("@nestjs/common");
    dependencies.add("@nestjs/core");
    dependencies.add("reflect-metadata");
    devDependencies.add("@nestjs/cli");
  }
}

function addDataPackages(
  database: DatabaseOption,
  orm: OrmOption,
  dependencies: Set<string>,
  devDependencies: Set<string>
) {
  if (database === "postgresql") dependencies.add("pg");
  if (database === "mysql") dependencies.add("mysql2");
  if (database === "sqlite") dependencies.add("better-sqlite3");
  if (database === "mongodb") dependencies.add("mongodb");
  if (orm === "prisma") {
    dependencies.add("@prisma/client");
    devDependencies.add("prisma");
  }
  if (orm === "drizzle") {
    dependencies.add("drizzle-orm");
    devDependencies.add("drizzle-kit");
  }
  if (orm === "kysely") dependencies.add("kysely");
}

function addQualityPackages(
  codeQuality: CodeQualityOption,
  devDependencies: Set<string>
) {
  if (codeQuality === "biome") devDependencies.add("@biomejs/biome");
  if (codeQuality === "prettier" || codeQuality === "eslint-prettier") {
    devDependencies.add("prettier");
  }
  if (codeQuality === "eslint" || codeQuality === "eslint-prettier") {
    devDependencies.add("eslint");
  }
}

function addAdvancedPackages(
  advancedOptions: AdvancedProjectOption[],
  devDependencies: Set<string>
) {
  if (advancedOptions.includes("unitTests")) devDependencies.add("vitest");
  if (advancedOptions.includes("e2eTests")) devDependencies.add("@playwright/test");
  if (advancedOptions.includes("auth")) devDependencies.add("better-auth");
}

function projectOverlays(
  configuration: NewProjectConfiguration,
  target: string
) {
  const overlays: Array<{ path: string; content: string }> = [];
  const advanced = configuration.advancedOptions;

  if (advanced.includes("envExample")) {
    overlays.push({ path: join(target, ".env.example"), content: envExample(configuration) });
  }

  if (advanced.includes("readme")) {
    overlays.push({ path: join(target, "README.md"), content: readme(configuration, target) });
  }

  if (advanced.includes("docker")) {
    overlays.push({ path: join(target, "Dockerfile"), content: dockerfile(configuration) });
  }

  if (advanced.includes("dockerCompose")) {
    overlays.push({ path: join(target, "docker-compose.yml"), content: dockerCompose(configuration) });
  }

  if (advanced.includes("githubActions")) {
    overlays.push({ path: join(target, ".github", "workflows", "ci.yml"), content: githubActions(configuration) });
  }

  if (advanced.includes("blamePreview")) {
    overlays.push({ path: join(target, ".blame", "preview.json"), content: blamePreview(configuration) });
  }

  if (configuration.backend === "fastapi") {
    overlays.push({ path: join(target, "api", "main.py"), content: fastApiMain() });
    overlays.push({ path: join(target, "pyproject.toml"), content: pyproject(configuration) });
  }

  return overlays;
}

async function applyProjectOverlays(
  target: string,
  overlays: Array<{ path: string; content: string }>
) {
  await updatePackageJson(target);

  for (const overlay of overlays) {
    await mkdir(resolve(overlay.path, ".."), { recursive: true });
    await writeFile(overlay.path, overlay.content, "utf8");
  }
}

async function renameScaffoldTarget(scaffoldTarget: string, target: string) {
  if (scaffoldTarget === target) return;
  if (!existsSync(scaffoldTarget)) {
    throw new Error("Scaffold command did not create the expected project directory.");
  }
  if (existsSync(target)) {
    throw new Error("Project directory already exists after scaffold.");
  }
  await rename(scaffoldTarget, target);
}

async function updatePackageJson(target: string) {
  const path = join(target, "package.json");
  if (!existsSync(path)) return;
  const parsed = JSON.parse(await readFile(path, "utf8"));
  parsed.scripts = {
    dev: parsed.scripts?.dev ?? "vite --host 0.0.0.0",
    build: parsed.scripts?.build ?? "vite build",
    lint: parsed.scripts?.lint ?? "eslint .",
    test: parsed.scripts?.test ?? "vitest run",
    ...parsed.scripts,
  };
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

function installCommand(packageManager: string, target: string): CommandRecipe {
  if (packageManager === "npm") return { command: "npm", args: ["install"], cwd: target };
  if (packageManager === "yarn") return { command: "yarn", args: ["install"], cwd: target };
  if (packageManager === "bun") return { command: "bun", args: ["install"], cwd: target };
  return { command: "pnpm", args: ["install"], cwd: target };
}

function addCommand(
  packageManager: string,
  target: string,
  packages: string[],
  dev: boolean
): CommandRecipe {
  if (packageManager === "npm") {
    return { command: "npm", args: ["install", dev ? "--save-dev" : "--save", ...packages], cwd: target };
  }
  if (packageManager === "yarn") {
    return { command: "yarn", args: ["add", ...(dev ? ["--dev"] : []), ...packages], cwd: target };
  }
  if (packageManager === "bun") {
    return { command: "bun", args: ["add", ...(dev ? ["--dev"] : []), ...packages], cwd: target };
  }
  return { command: "pnpm", args: ["add", ...(dev ? ["-D"] : []), ...packages], cwd: target };
}

function createArgs(packageManager: string, packageName: string) {
  if (packageManager === "npm") return ["create", `${packageName}@latest`];
  if (packageManager === "yarn") return ["create", packageName];
  if (packageManager === "bun") return ["create", packageName];
  return ["create", packageName];
}

function nextQualityArgs(codeQuality: CodeQualityOption) {
  if (codeQuality === "biome") return ["--biome"];
  if (codeQuality === "none" || codeQuality === "prettier") return ["--no-linter"];
  return ["--eslint"];
}

function nextPackageManagerArgs(packageManager: string) {
  if (packageManager === "npm") return ["--use-npm"];
  if (packageManager === "yarn") return ["--use-yarn"];
  if (packageManager === "bun") return ["--use-bun"];
  return ["--use-pnpm"];
}

function nodePackageManager(packageManager: PackageManager) {
  if (["npm", "yarn", "bun"].includes(packageManager)) return packageManager;
  if (packageManager === "pnpm") return "pnpm";
  return "npm";
}

function scaffoldProjectName(target: string) {
  const name = basename(target);
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .toLowerCase();
}

function envExample(configuration: NewProjectConfiguration) {
  const lines = ["APP_URL=http://localhost:3000"];
  if (configuration.database !== "none") lines.push("DATABASE_URL=");
  if (configuration.advancedOptions.includes("auth")) lines.push("AUTH_SECRET=");
  return `${lines.join("\n")}\n`;
}

function readme(configuration: NewProjectConfiguration, target: string) {
  const packageManager = nodePackageManager(configuration.packageManager);
  return [
    `# ${basename(target)}`,
    "",
    "Generated by Blame.",
    "",
    "## Development",
    "",
    `- Install: \`${packageManager} install\``,
    `- Dev server: \`${packageManager} run dev\``,
    `- Build: \`${packageManager} run build\``,
    "",
  ].join("\n");
}

function dockerfile(configuration: NewProjectConfiguration) {
  const packageManager = nodePackageManager(configuration.packageManager);
  return [
    "FROM node:22-alpine",
    "WORKDIR /app",
    "COPY package.json ./",
    `RUN corepack enable && ${packageManager} install`,
    "COPY . .",
    `CMD [\"${packageManager}\", \"run\", \"dev\", \"--\", \"--host\", \"0.0.0.0\"]`,
    "",
  ].join("\n");
}

function dockerCompose(configuration: NewProjectConfiguration) {
  const database = databaseService(configuration.database);
  const services = [
    "services:",
    "  app:",
    "    build: .",
    "    ports:",
    "      - \"3000:3000\"",
    "    labels:",
    "      blame.preview: \"true\"",
  ];

  if (database) services.push(...database);
  return `${services.join("\n")}\n`;
}

function databaseService(database: DatabaseOption) {
  if (database === "postgresql") {
    return [
      "  database:",
      "    image: postgres:17-alpine",
      "    environment:",
      "      POSTGRES_PASSWORD: blame",
      "      POSTGRES_DB: blame",
    ];
  }
  if (database === "mysql") {
    return [
      "  database:",
      "    image: mysql:9",
      "    environment:",
      "      MYSQL_ROOT_PASSWORD: blame",
      "      MYSQL_DATABASE: blame",
    ];
  }
  if (database === "mongodb") {
    return ["  database:", "    image: mongo:8"];
  }
  return undefined;
}

function githubActions(configuration: NewProjectConfiguration) {
  const packageManager = nodePackageManager(configuration.packageManager);
  return [
    "name: CI",
    "on: [push, pull_request]",
    "jobs:",
    "  check:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v5",
    "      - uses: actions/setup-node@v5",
    "        with:",
    "          node-version: 22",
    `      - run: corepack enable && ${packageManager} install`,
    `      - run: ${packageManager} run build`,
    "",
  ].join("\n");
}

function blamePreview(configuration: NewProjectConfiguration) {
  const port = configuration.frontend === "next" || configuration.frontend === "nuxt" ? 3000 : 5173;
  return `${JSON.stringify({ command: "dev", port }, null, 2)}\n`;
}

function fastApiMain() {
  return [
    "from fastapi import FastAPI",
    "",
    "app = FastAPI()",
    "",
    "",
    "@app.get('/health')",
    "def health():",
    "    return {'status': 'ok'}",
    "",
  ].join("\n");
}

function pyproject(configuration: NewProjectConfiguration) {
  const dependencies = ["fastapi", "uvicorn[standard]"];
  if (configuration.orm === "sqlalchemy") dependencies.push("sqlalchemy", "alembic");
  if (configuration.orm === "sqlmodel") dependencies.push("sqlmodel", "alembic");
  return [
    "[project]",
    "name = \"api\"",
    "version = \"0.1.0\"",
    "requires-python = \">=3.12\"",
    `dependencies = [${dependencies.map((item) => `"${item}"`).join(", ")}]`,
    "",
  ].join("\n");
}

function runCommand(
  recipe: CommandRecipe,
  emit: (event: ProjectCreationEvent) => void
) {
  emit({ type: "stdout", data: `$ ${recipe.command} ${recipe.args.join(" ")}\n` });

  return new Promise<void>((resolveCommand, reject) => {
    const child = spawn(recipe.command, recipe.args, {
      cwd: recipe.cwd,
      env: process.env,
      shell: process.platform === "win32",
    });

    child.stdout.on("data", (data: Buffer) =>
      emit({ type: "stdout", data: data.toString() })
    );
    child.stderr.on("data", (data: Buffer) =>
      emit({ type: "stderr", data: data.toString() })
    );
    child.on("error", (error) => reject(error));
    child.on("exit", (code) => {
      if (code === 0) return resolveCommand();
      reject(new Error(`${recipe.command} exited with code ${code ?? "unknown"}.`));
    });
  });
}

function projectCreationEmitter(runId: string) {
  return (event: ProjectCreationEvent) => {
    for (const window of projectCreationWindowsProvider()) {
      window.webContents.send(`workspace:project-creation:event:${runId}`, event);
    }
  };
}
