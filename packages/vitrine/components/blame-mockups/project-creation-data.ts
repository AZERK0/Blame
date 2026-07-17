export type ProjectOption = {
  description: string;
  disabled?: boolean;
  label: string;
  recommended?: boolean;
  value: string;
};

export const projectSteps = [
  [
    "location",
    "Location",
    "Location",
    "Choose where Blame should create the project.",
  ],
  [
    "platform",
    "Platform",
    "Platform",
    "Choose the kind of project to generate.",
  ],
  [
    "frontend",
    "Frontend",
    "Frontend framework",
    "The frontend choice drives the rest of the wizard.",
  ],
  [
    "styling",
    "Styling",
    "Styling and UI",
    "Configure styling separately from the component library.",
  ],
  [
    "backend",
    "Backend",
    "Backend framework",
    "Choose the backend shape Blame should scaffold.",
  ],
  [
    "data",
    "Data",
    "Database and ORM",
    "Pick the persistence layer for the generated project.",
  ],
  [
    "quality",
    "Quality",
    "Code quality",
    "Configure linting, formatting and project hygiene.",
  ],
  [
    "advanced",
    "Advanced",
    "Advanced options",
    "Enable the project extras Blame should prepare.",
  ],
  [
    "summary",
    "Summary",
    "Summary",
    "Review the project before Blame generates it.",
  ],
].map(([id, label, title, description]) => ({ id, label, title, description }));

export type ProjectConfiguration = {
  advancedOptions: string[];
  backend: string;
  codeQuality: string;
  database: string;
  frontend: string;
  orm: string;
  packageManager: string;
  platform: string;
  styling: string;
  uiLibrary: string;
};

export type ConfigurationKey = Exclude<
  keyof ProjectConfiguration,
  "advancedOptions"
>;

export const defaultConfiguration: ProjectConfiguration = {
  platform: "web",
  frontend: "next",
  styling: "tailwind",
  uiLibrary: "shadcn",
  backend: "next-api",
  database: "postgresql",
  orm: "prisma",
  packageManager: "pnpm",
  codeQuality: "eslint-prettier",
  advancedOptions: [
    "envExample",
    "readme",
    "typescriptAlias",
    "standardScripts",
    "blamePreview",
  ],
};

export const platformOptions = [
  option(
    "web",
    "Web application",
    "Frontend, full-stack app, or web service ready for Blame.",
  ),
  option(
    "backend",
    "Backend service",
    "API or service template. Available later.",
    false,
    true,
  ),
  option(
    "desktop",
    "Desktop application",
    "Electron, Tauri, or native desktop. Available later.",
    false,
    true,
  ),
  option(
    "mobile",
    "Mobile application",
    "Mobile app template. Available later.",
    false,
    true,
  ),
  option(
    "cli",
    "CLI / Script",
    "Command line tool or automation script. Available later.",
    false,
    true,
  ),
  option(
    "package",
    "Library / Package",
    "Reusable package template. Available later.",
    false,
    true,
  ),
];

export const frontendOptions = [
  option(
    "next",
    "Next.js",
    "React full-stack framework with App Router.",
    true,
  ),
  option("react-vite", "React + Vite", "Client app with fast Vite tooling."),
  option("nuxt", "Nuxt", "Vue full-stack framework powered by Nitro."),
  option("vue-vite", "Vue + Vite", "Vue client app with Vite."),
  option("sveltekit", "SvelteKit", "Full-stack Svelte application."),
  option("none", "None", "No frontend generated."),
];

export const stylingOptions = [
  option("tailwind", "Tailwind CSS", "Utility-first styling.", true),
  option("css-modules", "CSS Modules", "Scoped CSS files."),
  option("sass", "Sass", "SCSS syntax and variables."),
  option("vanilla-css", "Vanilla CSS", "Plain global CSS."),
  option("none", "None", "No styling setup."),
];

export const databaseOptions = [
  option("postgresql", "PostgreSQL", "Default relational database.", true),
  option("mysql", "MySQL", "Relational database."),
  option("sqlite", "SQLite", "Local SQL database."),
  option("mongodb", "MongoDB", "Document database."),
  option("none", "None", "No database setup."),
];

export const advancedOptions = [
  option("docker", "Docker", "Container-ready project."),
  option("dockerCompose", "docker-compose", "Local service orchestration."),
  option("monorepo", "Monorepo", "Workspace package layout."),
  option("auth", "Auth", "Authentication foundation."),
  option("unitTests", "Unit tests", "Unit test setup."),
  option("e2eTests", "E2E tests", "Browser test setup."),
  option("githubActions", "GitHub Actions CI", "Automated quality checks."),
  option("envExample", ".env.example", "Documented environment variables."),
  option("readme", "Generated README", "Project setup documentation."),
  option("typescriptAlias", "TypeScript alias", "Short import paths."),
  option("standardScripts", "dev/build/lint/test", "Standard project scripts."),
  option(
    "blamePreview",
    "Blame local preview",
    "Preview configuration for Blame.",
  ),
];

export const generationStages = [
  stage(
    "Preparation",
    "$ Preparing project workspace\n✓ Configuration validated\n",
    900,
  ),
  stage(
    "AI generation",
    "$ Generating application structure\n✓ Routes and components created\n",
    1250,
  ),
  stage(
    "Installing dependencies",
    "$ pnpm install\n✓ 287 packages installed\n",
    1100,
  ),
  stage(
    "Verification",
    "$ pnpm lint && pnpm build\n✓ Quality checks passed\n",
    1050,
  ),
  stage(
    "Generation finished",
    "✓ Project is ready for its first user story\n",
    0,
  ),
];

export function uiLibraryOptions(frontend: string) {
  if (frontend === "next" || frontend === "react-vite") return reactUiOptions;
  if (frontend === "nuxt" || frontend === "vue-vite")
    return vueUiOptions(frontend);
  if (frontend === "sveltekit") return svelteUiOptions;
  return [option("none", "None", "No UI library.", false, true)];
}

export function backendOptions(frontend: string) {
  if (frontend === "next") return nextBackendOptions;
  if (frontend === "nuxt") return nuxtBackendOptions;
  return detachedBackendOptions;
}

export function ormOptions(backend: string, database: string) {
  if (database === "none" || backend === "none") {
    return [option("none", "None", "No ORM.", false, true)];
  }
  if (backend === "fastapi") return pythonOrmOptions;
  return javascriptOrmOptions(database);
}

export function packageManagerOptions(backend: string) {
  return backend === "fastapi" ? pythonPackageOptions : nodePackageOptions;
}

export function qualityOptions(frontend: string, backend: string) {
  const standard = backend === "nest" || frontend === "next";
  return [
    option("biome", "Biome", "Modern linting and formatting.", !standard),
    option(
      "eslint-prettier",
      "ESLint + Prettier",
      "Standard framework linting.",
      standard,
    ),
    option("eslint", "ESLint only", "Linting without formatter."),
    option("prettier", "Prettier only", "Formatting only."),
    option("none", "None", "No quality tooling."),
  ];
}

export function recommendedUiLibrary(frontend: string) {
  if (frontend === "nuxt") return "nuxt-ui";
  if (frontend === "vue-vite") return "primevue";
  if (frontend === "sveltekit") return "shadcn-svelte";
  if (frontend === "next" || frontend === "react-vite") return "shadcn";
  return "none";
}

export function recommendedBackend(frontend: string) {
  if (frontend === "next") return "next-api";
  if (frontend === "nuxt") return "nitro";
  return "hono";
}

export function optionLabel(options: ProjectOption[], value: string) {
  return options.find((item) => item.value === value)?.label ?? value;
}

export function requiresTailwind(uiLibrary: string) {
  return ["shadcn", "shadcn-svelte", "daisyui"].includes(uiLibrary);
}

export function normalizeProjectConfiguration(
  configuration: ProjectConfiguration,
): ProjectConfiguration {
  const frontend = configuration.platform === "web" ? configuration.frontend : "none";
  const uiLibrary = normalizeUiLibrary(frontend, configuration.uiLibrary);
  const styling = normalizeStyling(frontend, uiLibrary, configuration.styling);
  const backend = normalizeBackend(frontend, configuration.backend);
  const orm = normalizeOrm(backend, configuration.database, configuration.orm);
  const packageManager = normalizePackageManager(
    backend,
    configuration.packageManager,
  );
  const codeQuality = normalizeCodeQuality(
    frontend,
    backend,
    configuration.codeQuality,
  );
  return {
    ...configuration,
    frontend,
    uiLibrary,
    styling,
    backend,
    orm,
    packageManager,
    codeQuality,
  };
}

function normalizeUiLibrary(frontend: string, current: string) {
  const available = availableOptions(uiLibraryOptions(frontend));
  if (available.some((option) => option.value === current)) return current;
  return recommendedUiLibrary(frontend);
}

function normalizeStyling(frontend: string, uiLibrary: string, current: string) {
  if (frontend === "none") return "none";
  if (requiresTailwind(uiLibrary)) return "tailwind";
  return current;
}

function normalizeBackend(frontend: string, current: string) {
  const available = availableOptions(backendOptions(frontend));
  if (available.some((option) => option.value === current)) return current;
  return recommendedBackend(frontend);
}

function normalizeOrm(backend: string, database: string, current: string) {
  const available = availableOptions(ormOptions(backend, database));
  if (available.some((option) => option.value === current)) return current;
  return recommendedOption(available);
}

function normalizePackageManager(backend: string, current: string) {
  const available = availableOptions(packageManagerOptions(backend));
  if (available.some((option) => option.value === current)) return current;
  return backend === "fastapi" ? "uv" : "pnpm";
}

function normalizeCodeQuality(frontend: string, backend: string, current: string) {
  const available = availableOptions(qualityOptions(frontend, backend));
  if (available.some((option) => option.value === current)) return current;
  return recommendedOption(available);
}

function availableOptions(options: ProjectOption[]) {
  return options.filter((option) => !option.disabled);
}

function recommendedOption(options: ProjectOption[]) {
  return options.find((option) => option.recommended)?.value ?? "none";
}

function option(
  value: string,
  label: string,
  description: string,
  recommended = false,
  disabled = false,
): ProjectOption {
  return { value, label, description, recommended, disabled };
}

function stage(label: string, log: string, duration: number) {
  return { label, log, duration };
}

const reactUiOptions = [
  option("shadcn", "shadcn/ui", "Composable UI with Tailwind.", true),
  option("radix", "Radix UI", "Accessible primitives."),
  option("mantine", "Mantine", "React component library."),
  option("mui", "MUI", "Material UI components."),
  option("ant-design", "Ant Design", "Enterprise React components."),
  option("daisyui", "DaisyUI", "Tailwind component classes."),
  option("none", "None", "No UI library."),
];

const svelteUiOptions = [
  option(
    "shadcn-svelte",
    "shadcn-svelte",
    "Svelte components with Tailwind.",
    true,
  ),
  option("skeleton", "Skeleton", "Svelte UI toolkit."),
  option("melt-ui", "Melt UI", "Svelte headless builders."),
  option("flowbite-svelte", "Flowbite Svelte", "Tailwind Svelte components."),
  option("daisyui", "DaisyUI", "Tailwind component classes."),
  option("none", "None", "No UI library."),
];

const nextBackendOptions = [
  option(
    "next-api",
    "Next.js API / Server Actions",
    "Route handlers and server actions.",
    true,
  ),
  option("nest", "NestJS", "Structured Node backend."),
  option("hono", "Hono", "Small TypeScript web framework."),
  option("none", "None", "No backend."),
];

const nuxtBackendOptions = [
  option("nitro", "Nitro server", "Nuxt server API.", true),
  option("nest", "NestJS", "Structured Node backend."),
  option("fastapi", "FastAPI", "Python API backend."),
  option("none", "None", "No backend."),
];

const detachedBackendOptions = [
  option("hono", "Hono", "Small TypeScript web framework.", true),
  option("fastify", "Fastify", "Fast Node backend."),
  option("nest", "NestJS", "Structured Node backend."),
  option("fastapi", "FastAPI", "Python API backend."),
  option("none", "None", "No backend."),
];

const pythonOrmOptions = [
  option("sqlalchemy", "SQLAlchemy + Alembic", "Python SQL toolkit.", true),
  option("sqlmodel", "SQLModel", "Pydantic-friendly SQL models."),
  option("none", "None", "No ORM."),
];

const nodePackageOptions = [
  option("pnpm", "pnpm", "Fast Node package manager.", true),
  option("npm", "npm", "Standard Node package manager."),
  option("yarn", "yarn", "Yarn package manager."),
  option("bun", "bun", "Bun runtime and package manager."),
];

const pythonPackageOptions = [
  option("uv", "uv", "Fast Python package manager.", true),
  option("poetry", "poetry", "Python dependency manager."),
  option("pip", "pip", "Standard Python installer."),
];

function vueUiOptions(frontend: string) {
  return [
    option(
      "nuxt-ui",
      "Nuxt UI",
      "Nuxt-first UI library.",
      frontend === "nuxt",
      frontend !== "nuxt",
    ),
    option(
      "primevue",
      "PrimeVue",
      "Vue component library.",
      frontend === "vue-vite",
    ),
    option("vuetify", "Vuetify", "Material Vue components."),
    option("naive-ui", "Naive UI", "Vue component library."),
    option("daisyui", "DaisyUI", "Tailwind component classes."),
    option("none", "None", "No UI library."),
  ];
}

function javascriptOrmOptions(database: string) {
  return [
    option("prisma", "Prisma", "Classic SaaS ORM.", database !== "mongodb"),
    option(
      "drizzle",
      "Drizzle",
      "Lightweight SQL-first ORM.",
      false,
      database === "mongodb",
    ),
    option(
      "kysely",
      "Kysely",
      "Typed SQL query builder.",
      false,
      database === "mongodb",
    ),
    option("none", "None", "No ORM."),
  ];
}
