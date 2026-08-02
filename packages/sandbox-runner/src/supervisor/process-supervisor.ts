import { spawn } from "node:child_process";
import { mkdir, open, realpath } from "node:fs/promises";
import type {
  PreviewExecutionPlan,
  RuntimeSelection,
  ServiceLaunchPlan,
} from "@blame/preview-runtime";
import { runtimePaths } from "../runtime-paths.js";
import { runnerError } from "../protocol/runner-server.js";

export class ProcessSupervisor {
  async prepare(plan: PreviewExecutionPlan) {
    assertProcessPlan(plan);
    await mkdir(runtimePaths.logs, { recursive: true, mode: 0o700 });
    for (const task of plan.setup) {
      if (task.runAs === "root") {
        throw runnerError(
          "PROCESS_ROOT_SETUP_UNSUPPORTED",
          "Native process setup cannot request an unrestricted root shell.",
        );
      }
      await runProjectCommand(
        task.command,
        await workspaceDirectory(task.workingDir),
        task.environment,
        `${runtimePaths.logs}/setup-${task.id}.log`,
      );
    }
  }

  async start(
    plan: PreviewExecutionPlan,
    selection: RuntimeSelection,
    browserBindingUrls: Record<string, string>,
  ) {
    const identity = await projectIdentity();
    const pids: Record<string, number> = {};
    for (const service of launchOrder(selectedServices(plan.services, selection.serviceIds))) {
      if (!service.command) continue;
      const log = await open(`${runtimePaths.logs}/${safeId(service.id)}.log`, "a", 0o600);
      const child = spawn("prlimit", [
        "--nproc=512:512",
        "--nofile=4096:4096",
        "--fsize=104857600:104857600",
        "--",
        "/bin/sh",
        "-lc",
        service.command,
      ], {
        cwd: await workspaceDirectory(service.workingDir),
        env: projectEnvironment(compiledEnvironment(service, plan, browserBindingUrls)),
        uid: identity.uid,
        gid: identity.gid,
        detached: true,
        stdio: ["ignore", log.fd, log.fd],
      });
      child.unref();
      if (!child.pid) throw runnerError("PROCESS_START_FAILED", `Unable to start ${service.id}.`);
      pids[service.id] = child.pid;
    }
    return pids;
  }

  async stop(pids: Record<string, number>) {
    for (const pid of Object.values(pids)) signalGroup(pid, "SIGTERM");
    await delay(5_000);
    for (const pid of Object.values(pids)) {
      if (processRunning(pid)) signalGroup(pid, "SIGKILL");
    }
  }

  inspect(plan: PreviewExecutionPlan, pids: Record<string, number>) {
    return plan.services.map(({ id }) => ({
      id,
      running: Boolean(pids[id] && processRunning(pids[id]!)),
      healthy: undefined,
    }));
  }

  targets(plan: PreviewExecutionPlan) {
    return Object.fromEntries(
      plan.services.flatMap((service) =>
        service.endpoints.map((endpoint) => [
          `${service.id}:${endpoint.id}`,
          { host: "127.0.0.1" as const, port: endpoint.port },
        ]),
      ),
    );
  }
}

function selectedServices(services: ServiceLaunchPlan[], selected: string[] | undefined) {
  if (!selected?.length) return services;
  const wanted = new Set(selected);
  let changed = true;
  while (changed) {
    changed = false;
    for (const service of services) {
      if (!wanted.has(service.id)) continue;
      for (const dependency of service.dependsOn) {
        if (!wanted.has(dependency)) { wanted.add(dependency); changed = true; }
      }
    }
  }
  const unknown = [...wanted].filter((id) => !services.some((service) => service.id === id));
  if (unknown.length) throw runnerError("INVALID_SELECTION", `Unknown selected services: ${unknown.join(", ")}.`);
  return services.filter(({ id }) => wanted.has(id));
}

function assertProcessPlan(plan: PreviewExecutionPlan) {
  const ports = new Map<number, string>();
  for (const item of [...plan.setup, ...plan.services]) {
    if (item.source.kind === "container") {
      throw runnerError("PROCESS_SOURCE_UNSUPPORTED", `${item.id} requires a container image.`);
    }
    if (item.source.toolchain && item.source.toolchain !== "node24") {
      throw runnerError("PROCESS_TOOLCHAIN_UNAVAILABLE", `Toolchain ${item.source.toolchain} is unavailable.`);
    }
  }
  for (const item of [...plan.setup, ...plan.services]) {
    if (Object.keys(item.environment).some((key) => /(TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY)$/i.test(key))) {
      throw runnerError(
        "RAW_SECRET_REJECTED",
        "Secret-looking environment values require the explicit secret delivery channel.",
      );
    }
  }
  for (const service of plan.services) {
    for (const endpoint of service.endpoints) {
      const owner = ports.get(endpoint.port);
      if (owner) {
        throw runnerError(
          "DUPLICATE_LOGICAL_PORT",
          `${owner} and ${service.id} both claim process port ${endpoint.port}.`,
        );
      }
      ports.set(endpoint.port, service.id);
    }
  }
}

async function workspaceDirectory(path: string) {
  const resolved = await realpath(path).catch(() => "");
  if (resolved !== runtimePaths.workspace && !resolved.startsWith(`${runtimePaths.workspace}/`)) {
    throw runnerError("WORKSPACE_ACCESS_DENIED", "Process working directory is outside /workspace.");
  }
  return resolved;
}

function compiledEnvironment(
  service: ServiceLaunchPlan,
  plan: PreviewExecutionPlan,
  browserBindingUrls: Record<string, string>,
) {
  const environment = { ...service.environment };
  for (const binding of service.bindings) {
    const source = plan.services.find(({ id }) => id === binding.sourceServiceId);
    const endpoint = source?.endpoints.find(({ id }) => id === binding.sourceEndpointId);
    if (!source || !endpoint) throw runnerError("INVALID_PLAN", "Binding source is missing.");
    if (binding.exposure === "browser") {
      const publicUrl = browserBindingUrls[`${source.id}:${endpoint.id}`];
      if (!publicUrl) throw runnerError("BROWSER_BINDING_UNAVAILABLE", "Browser URL is unavailable.");
      const url = new URL(publicUrl);
      environment[binding.targetKey] = formatBinding(
        binding.format,
        url.hostname,
        url.port || (url.protocol === "https:" ? "443" : "80"),
        `${publicUrl}${binding.path}`,
      );
    } else {
      environment[binding.targetKey] = formatBinding(
        binding.format,
        "localhost",
        String(endpoint.port),
        `${endpoint.protocol}://localhost:${endpoint.port}${binding.path}`,
      );
    }
  }
  return environment;
}

function formatBinding(format: string, host: string, port: string, url: string) {
  if (format === "host") return host;
  if (format === "port") return port;
  if (format === "host-port") return `${host}:${port}`;
  return url;
}

function launchOrder(services: ServiceLaunchPlan[]) {
  const pending = new Map(services.map((service) => [service.id, service]));
  const ordered: ServiceLaunchPlan[] = [];
  while (pending.size) {
    const ready = [...pending.values()].filter((service) =>
      service.dependsOn.every((id) => !pending.has(id)),
    );
    if (!ready.length) throw runnerError("INVALID_PLAN", "Service dependencies contain a cycle.");
    for (const service of ready) {
      pending.delete(service.id);
      ordered.push(service);
    }
  }
  return ordered;
}

async function runProjectCommand(
  command: string,
  cwd: string,
  environment: Record<string, string>,
  logPath: string,
) {
  const identity = await projectIdentity();
  const log = await open(logPath, "a", 0o600);
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn("prlimit", [
      "--nproc=512:512",
      "--nofile=4096:4096",
      "--fsize=104857600:104857600",
      "--",
      "/bin/sh",
      "-lc",
      command,
    ], {
      cwd,
      env: projectEnvironment(environment),
      uid: identity.uid,
      gid: identity.gid,
      stdio: ["ignore", log.fd, log.fd],
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) throw runnerError("SETUP_FAILED", "A process setup task failed.");
}

async function projectIdentity() {
  const [uid, gid] = await Promise.all([idValue("-u"), idValue("-g")]);
  return { uid, gid };
}

function idValue(flag: "-u" | "-g") {
  return new Promise<number>((resolve, reject) => {
    const child = spawn("id", [flag, "blame-project"], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (output += chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      const value = Number(output.trim());
      if (code !== 0 || !Number.isSafeInteger(value)) reject(new Error("Project identity is unavailable."));
      else resolve(value);
    });
  });
}

function projectEnvironment(environment: Record<string, string>) {
  const base = {
    HOME: "/home/blame-project",
    PATH: "/usr/local/bin:/usr/bin:/bin",
    USER: "blame-project",
    LOGNAME: "blame-project",
  };
  return { ...base, ...environment };
}

function processRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch {}
}

function safeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
