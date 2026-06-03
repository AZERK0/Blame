import type {
  BackendFramework,
  DatabaseOption,
  FrontendFramework,
  NewProjectConfiguration,
  OrmOption,
  PackageManager,
} from "./project-creation";

export type ProjectSetupRecipe = {
  dockerCompose: string;
  setupScript: string;
};

type RuntimePlan = {
  packageManager: string;
  installCommand: string;
  devCommand: string;
  previewPort: number;
};

type ServiceSpec = {
  name: string;
  image: string;
  command?: string;
  dependsOn?: string[];
  environment?: Record<string, string>;
  labels?: Record<string, string>;
  ports?: string[];
  volumes?: string[];
  workingDir?: string;
};

export function projectSetupRecipe(
  configuration: NewProjectConfiguration
): ProjectSetupRecipe {
  const runtime = runtimePlan(configuration);
  const services = [
    nodeAppService(configuration, runtime),
    ...backendServices(configuration),
    ...databaseServices(configuration.database),
  ];

  return {
    dockerCompose: composeYaml(services),
    setupScript: setupScript(configuration, runtime),
  };
}

export function setupScript(
  configuration: NewProjectConfiguration,
  runtime = runtimePlan(configuration)
) {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "corepack enable || true",
    runtime.installCommand,
    ...backendSetupCommands(configuration),
    ...ormSetupCommands(configuration),
    "",
  ].join("\n");
}

export function dockerCompose(
  configuration: NewProjectConfiguration,
  runtime = runtimePlan(configuration)
) {
  return composeYaml([
    nodeAppService(configuration, runtime),
    ...backendServices(configuration),
    ...databaseServices(configuration.database),
  ]);
}

export function runtimePlan(configuration: NewProjectConfiguration): RuntimePlan {
  const packageManager = nodePackageManager(configuration.packageManager);
  return {
    packageManager,
    installCommand: `${packageManager} install`,
    devCommand: `${packageManager} run dev -- ${devHostArgs(configuration.frontend)}`,
    previewPort: previewPort(configuration.frontend),
  };
}

function nodeAppService(
  configuration: NewProjectConfiguration,
  runtime: RuntimePlan
): ServiceSpec {
  return {
    name: "app",
    image: "node:22-alpine",
    workingDir: "/workspace",
    command: `sh -lc "corepack enable && ${runtime.installCommand} && ${runtime.devCommand}"`,
    volumes: [".:/workspace"],
    ports: [`${runtime.previewPort}:${runtime.previewPort}`],
    environment: nodeEnvironment(configuration),
    dependsOn: serviceDependencies(configuration),
    labels: {
      "blame.preview": "true",
      "blame.preview.port": String(runtime.previewPort),
    },
  };
}

function backendServices(configuration: NewProjectConfiguration): ServiceSpec[] {
  if (nodeBackendService(configuration.backend)) {
    return [
      {
        name: "api",
        image: "node:22-alpine",
        workingDir: "/workspace",
        command: `sh -lc "corepack enable && ${nodePackageManager(configuration.packageManager)} install && ${nodeApiCommand(configuration.backend)}"`,
        volumes: [".:/workspace"],
        ports: ["4000:4000"],
        environment: nodeApiEnvironment(configuration),
        dependsOn: databaseDependency(configuration.database),
      },
    ];
  }

  if (configuration.backend !== "fastapi") return [];

  return [
    {
      name: "api",
      image: "python:3.13-alpine",
      workingDir: "/workspace",
      command: `sh -lc "${pythonInstallCommand(configuration.packageManager)} && uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload"`,
      volumes: [".:/workspace"],
      ports: ["8000:8000"],
      environment: pythonEnvironment(configuration),
      dependsOn: databaseDependency(configuration.database),
    },
  ];
}

function databaseServices(database: DatabaseOption): ServiceSpec[] {
  if (database === "postgresql") {
    return [
      {
        name: "database",
        image: "postgres:17-alpine",
        ports: ["5432:5432"],
        environment: {
          POSTGRES_DB: "blame",
          POSTGRES_PASSWORD: "blame",
          POSTGRES_USER: "blame",
        },
      },
    ];
  }

  if (database === "mysql") {
    return [
      {
        name: "database",
        image: "mysql:9",
        ports: ["3306:3306"],
        environment: {
          MYSQL_DATABASE: "blame",
          MYSQL_PASSWORD: "blame",
          MYSQL_ROOT_PASSWORD: "blame",
          MYSQL_USER: "blame",
        },
      },
    ];
  }

  if (database === "mongodb") {
    return [
      {
        name: "database",
        image: "mongo:8",
        ports: ["27017:27017"],
      },
    ];
  }

  return [];
}

function backendSetupCommands(configuration: NewProjectConfiguration) {
  if (configuration.backend !== "fastapi") return [];
  return [pythonInstallCommand(configuration.packageManager)];
}

function ormSetupCommands(configuration: NewProjectConfiguration) {
  if (configuration.orm === "prisma") return ["npx prisma generate || true"];
  if (configuration.orm === "drizzle") return ["npx drizzle-kit generate || true"];
  if (configuration.orm === "sqlalchemy") return ["uv run alembic upgrade head || true"];
  if (configuration.orm === "sqlmodel") return ["uv run alembic upgrade head || true"];
  return [];
}

function nodeEnvironment(configuration: NewProjectConfiguration) {
  return compactRecord({
    DATABASE_URL: databaseUrl(configuration.database, configuration.orm),
    NEXT_PUBLIC_API_URL: externalApiUrl(configuration.backend),
    VITE_API_URL: externalApiUrl(configuration.backend),
  });
}

function nodeApiEnvironment(configuration: NewProjectConfiguration) {
  return compactRecord({
    DATABASE_URL: databaseUrl(configuration.database, configuration.orm),
    PORT: "4000",
  });
}

function pythonEnvironment(configuration: NewProjectConfiguration) {
  return compactRecord({
    DATABASE_URL: databaseUrl(configuration.database, configuration.orm),
  });
}

function serviceDependencies(configuration: NewProjectConfiguration) {
  return [
    ...(separateApiBackend(configuration.backend) ? ["api"] : []),
    ...databaseDependency(configuration.database),
  ];
}

function separateApiBackend(backend: BackendFramework) {
  return backend === "fastapi" || nodeBackendService(backend);
}

function nodeBackendService(backend: BackendFramework) {
  return backend === "hono" || backend === "fastify" || backend === "nest";
}

function externalApiUrl(backend: BackendFramework) {
  if (backend === "fastapi") return "http://localhost:8000";
  if (nodeBackendService(backend)) return "http://localhost:4000";
  return undefined;
}

function nodeApiCommand(backend: BackendFramework) {
  const label = backendLabel(backend);
  return `if npm run | grep -q "dev:api"; then npm run dev:api -- --host 0.0.0.0; else echo "Add a dev:api script for ${label} on port 4000."; tail -f /dev/null; fi`;
}

function backendLabel(backend: BackendFramework) {
  if (backend === "hono") return "Hono";
  if (backend === "fastify") return "Fastify";
  if (backend === "nest") return "NestJS";
  return "the backend";
}

function databaseDependency(database: DatabaseOption) {
  if (database === "none" || database === "sqlite") return [];
  return ["database"];
}

function databaseUrl(database: DatabaseOption, orm: OrmOption) {
  if (database === "postgresql") return "postgresql://blame:blame@database:5432/blame";
  if (database === "mysql") return "mysql://blame:blame@database:3306/blame";
  if (database === "sqlite") return "file:./dev.db";
  if (database === "mongodb") return "mongodb://database:27017/blame";
  if (orm === "prisma" || orm === "drizzle" || orm === "kysely") return "file:./dev.db";
  return undefined;
}

function pythonInstallCommand(packageManager: PackageManager) {
  if (packageManager === "poetry") return "pip install poetry && poetry install";
  if (packageManager === "pip") return "pip install -e .";
  return "pip install uv && uv sync";
}

function nodePackageManager(packageManager: PackageManager) {
  if (["npm", "yarn", "bun"].includes(packageManager)) return packageManager;
  if (packageManager === "pnpm") return "pnpm";
  return "npm";
}

function previewPort(frontend: FrontendFramework) {
  if (frontend === "next" || frontend === "nuxt") return 3000;
  return 5173;
}

function devHostArgs(frontend: FrontendFramework) {
  if (frontend === "next") return "-H 0.0.0.0";
  return "--host 0.0.0.0";
}

function composeYaml(services: ServiceSpec[]) {
  return `${["services:", ...services.flatMap(serviceYaml)].join("\n")}\n`;
}

function serviceYaml(service: ServiceSpec) {
  return [
    `  ${service.name}:`,
    `    image: ${service.image}`,
    ...stringField("working_dir", service.workingDir),
    ...stringField("command", service.command),
    ...listField("volumes", service.volumes),
    ...listField("ports", service.ports),
    ...mapField("environment", service.environment),
    ...listField("depends_on", service.dependsOn),
    ...mapField("labels", service.labels),
  ];
}

function stringField(name: string, value: string | undefined) {
  return value ? [`    ${name}: ${quote(value)}`] : [];
}

function listField(name: string, values: string[] | undefined) {
  if (!values?.length) return [];
  return [`    ${name}:`, ...values.map((value) => `      - ${quote(value)}`)];
}

function mapField(name: string, values: Record<string, string> | undefined) {
  if (!values || Object.keys(values).length === 0) return [];
  return [
    `    ${name}:`,
    ...Object.entries(values).map(
      ([key, value]) => `      ${key}: ${quote(value)}`,
    ),
  ];
}

function compactRecord(values: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string] =>
      Boolean(entry[1]),
    ),
  );
}

function quote(value: string) {
  return JSON.stringify(value);
}
