import { spawn } from "node:child_process";
import { chown, mkdir, open, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  composeCacheVolumeName,
  renderCloudCompose,
  type ComposeRenderResult,
} from "./compose-renderer.js";
import { runtimePaths } from "../runtime-paths.js";
import type { PreviewExecutionPlan, RuntimeSelection } from "@blame/preview-runtime";
import { runnerError } from "../protocol/runner-server.js";

const dockerSocket = "/run/blame/docker.sock";
const dockerPidPath = "/run/blame/dockerd.pid";
const dockerDataRoot = "/var/lib/blame/docker";
const dockerVolumeRoot = `${dockerDataRoot}/volumes/`;
const dockerEnvironment = { DOCKER_HOST: `unix://${dockerSocket}` };

export class ComposeSupervisor {
  async prepare(plan: PreviewExecutionPlan, browserBindingUrls: Record<string, string>) {
    validateComposePlan(plan);
    const identity = await projectIdentity();
    const rendered = renderCloudCompose(plan, browserBindingUrls, {
      projectUser: `${identity.uid}:${identity.gid}`,
    });
    await mkdir(dirname(runtimePaths.composeFile), { recursive: true, mode: 0o700 });
    await writeFile(runtimePaths.composeFile, rendered.yaml, { mode: 0o600, flush: true });
    await writeFile(`${runtimePaths.composeFile}.targets.json`, JSON.stringify(rendered.targets), {
      mode: 0o600,
      flush: true,
    });
    await this.ensureDocker();
    await this.prepareCaches(plan, identity);
    await this.runSetup(plan);
  }

  async start(selection: RuntimeSelection) {
    await this.ensureDocker();
    await command("docker", [
      "compose", "-f", runtimePaths.composeFile, "up", "-d", "--remove-orphans",
      ...(selection.serviceIds ?? []),
    ]);
  }

  async stop() {
    if (!(await dockerReady())) return;
    await command("docker", ["compose", "-f", runtimePaths.composeFile, "down", "--remove-orphans", "--timeout", "15"]);
  }

  async inspect(plan: PreviewExecutionPlan) {
    if (!(await dockerReady())) {
      return plan.services.map(({ id }) => ({ id, running: false, healthy: false }));
    }
    const result = await command("docker", [
      "compose",
      "-f",
      runtimePaths.composeFile,
      "ps",
      "--format",
      "json",
    ], true);
    const rows = result.stdout
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const parsed = JSON.parse(line);
          return Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          return [];
        }
      }) as Array<{ Service?: string; State?: string; Health?: string }>;
    return plan.services.map(({ id }) => {
      const row = rows.find(({ Service }) => Service === id);
      return {
        id,
        running: row?.State === "running",
        healthy: row?.Health ? row.Health === "healthy" : undefined,
      };
    });
  }

  async targets(): Promise<ComposeRenderResult["targets"]> {
    return JSON.parse(await readFile(`${runtimePaths.composeFile}.targets.json`, "utf8"));
  }

  async logMessages(serviceIds: string[]) {
    if (!(await dockerReady())) return [];
    const messages: Array<{ serviceId: string; message: string }> = [];
    for (const serviceId of serviceIds) {
      const result = await command("docker", [
        "compose",
        "-f",
        runtimePaths.composeFile,
        "logs",
        "--no-color",
        "--no-log-prefix",
        "--tail",
        "5000",
        serviceId,
      ], true);
      messages.push(...result.stdout.split("\n").filter(Boolean).map((message) => ({
        serviceId,
        message,
      })));
    }
    return messages;
  }

  private async ensureDocker() {
    if (await dockerReady()) return;
    await resetStaleDocker();
    await mkdir(dirname(dockerSocket), { recursive: true, mode: 0o710 });
    const log = await open("/var/log/blame/dockerd.log", "a", 0o600);
    const child = spawn(
      "dockerd",
      [
        `--host=unix://${dockerSocket}`,
        `--data-root=${dockerDataRoot}`,
        `--pidfile=${dockerPidPath}`,
        "--iptables=true",
        "--log-driver=local",
        "--log-opt=max-size=10m",
        "--log-opt=max-file=3",
      ],
      { detached: true, stdio: ["ignore", log.fd, log.fd] },
    );
    child.unref();
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (await dockerReady()) return;
      await delay(500);
    }
    throw runnerError("DOCKERD_NOT_READY", "Docker Engine did not become ready.");
  }

  private async prepareCaches(
    plan: PreviewExecutionPlan,
    identity: { uid: number; gid: number },
  ) {
    for (const cache of plan.caches) {
      const volumeName = composeCacheVolumeName(cache.name);
      await command("docker", ["volume", "create", volumeName]);
      const inspected = await command("docker", [
        "volume",
        "inspect",
        "--format",
        "{{.Mountpoint}}",
        volumeName,
      ]);
      const mountpoint = await realpath(inspected.stdout.trim());
      if (!mountpoint.startsWith(dockerVolumeRoot) || !mountpoint.endsWith("/_data")) {
        throw runnerError("INVALID_CACHE_VOLUME", "Docker returned an invalid cache volume path.");
      }
      await chown(mountpoint, identity.uid, identity.gid);
    }
  }

  private async runSetup(plan: PreviewExecutionPlan) {
    for (const task of plan.setup) {
      const dependencies = task.dependsOn.filter((id) => plan.services.some((service) => service.id === id));
      if (dependencies.length) {
        await command("docker", [
          "compose",
          "-f",
          runtimePaths.composeFile,
          "up",
          "-d",
          ...dependencies,
        ]);
      }
      await command("docker", [
        "compose",
        "-f",
        runtimePaths.composeFile,
        "run",
        "--rm",
        `setup-${task.id}`,
      ]);
    }
  }
}

async function resetStaleDocker() {
  await command("pkill", ["-TERM", "-x", "dockerd"], true);
  await command("pkill", ["-TERM", "-x", "containerd"], true);
  await delay(500);
  await command("pkill", ["-KILL", "-x", "dockerd"], true);
  await command("pkill", ["-KILL", "-x", "containerd"], true);
  await rm(dockerSocket, { force: true });
  await rm(dockerPidPath, { force: true });
}

function validateComposePlan(plan: PreviewExecutionPlan) {
  for (const item of [...plan.setup, ...plan.services]) {
    if (Object.keys(item.environment).some((key) => /(TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY)$/i.test(key))) {
      throw runnerError(
        "RAW_SECRET_REJECTED",
        "Secret-looking environment values require the explicit secret delivery channel.",
      );
    }
  }
}

async function projectIdentity() {
  const uid = Number((await command("id", ["-u", "blame-project"])).stdout.trim());
  const gid = Number((await command("id", ["-g", "blame-project"])).stdout.trim());
  if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid)) {
    throw runnerError("PROJECT_IDENTITY_MISSING", "Sandbox project identity is unavailable.");
  }
  return { uid, gid };
}

async function dockerReady() {
  const result = await command("docker", ["info"], true);
  return result.exitCode === 0;
}

async function command(executable: string, args: string[], allowFailure = false) {
  const result = await new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(executable, args, {
      env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", ...dockerEnvironment },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout = `${stdout}${chunk}`.slice(-4 * 1024 * 1024)));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr = `${stderr}${chunk}`.slice(-4 * 1024 * 1024)));
    child.once("error", reject);
    child.once("exit", (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
  });
  if (!allowFailure && result.exitCode !== 0) {
    const detail = [result.stderr, result.stdout]
      .map((value) => value.trim())
      .filter(Boolean)
      .join("\n")
      .slice(0, 1_000);
    throw runnerError("COMPOSE_COMMAND_FAILED", `Compose command failed: ${detail}`);
  }
  return result;
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
