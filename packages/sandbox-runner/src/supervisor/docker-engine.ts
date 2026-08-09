import { spawn } from "node:child_process";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { runnerError } from "../protocol/runner-server.js";
import { measureRunnerPhase } from "../performance-measure.js";

const dockerSocket = "/run/blame/docker.sock";
const dockerPidPath = "/run/blame/dockerd.pid";
const dockerLaunchPidPath = "/run/blame/dockerd-launch.pid";
export const dockerDataRoot = "/var/lib/blame/docker";
export const dockerEnvironment = { DOCKER_HOST: `unix://${dockerSocket}` };

export async function kickstartDockerEngine() {
  if (await dockerReady()) return;
  if (await launchInProgress()) return;
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
  await log.close();
  child.unref();
  if (!child.pid)
    throw runnerError("DOCKERD_NOT_READY", "Docker Engine did not start.");
  await writeFile(dockerLaunchPidPath, String(child.pid), {
    mode: 0o600,
    flush: true,
  });
}

export async function ensureDockerEngine() {
  if (await dockerReady()) return;
  return measureRunnerPhase("dockerd.start", async () => {
    await kickstartDockerEngine();
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (await dockerReady()) return;
      await delay(500);
    }
    throw runnerError(
      "DOCKERD_NOT_READY",
      "Docker Engine did not become ready.",
    );
  });
}

export async function shutdownDockerEngine() {
  const terminated = await Promise.all([
    processCommand("pkill", ["-TERM", "-x", "dockerd"]),
    processCommand("pkill", ["-TERM", "-x", "containerd"]),
  ]);
  if (terminated.includes(0)) await delay(500);
  await Promise.all([
    processCommand("pkill", ["-KILL", "-x", "dockerd"]),
    processCommand("pkill", ["-KILL", "-x", "containerd"]),
  ]);
  await Promise.all([
    rm(dockerSocket, { force: true }),
    rm(dockerPidPath, { force: true }),
    rm(dockerLaunchPidPath, { force: true }),
  ]);
}

export async function dockerReady() {
  const result = await processCommand("docker", ["info"], dockerEnvironment);
  return result === 0;
}

async function launchInProgress() {
  const pid = await readFile(dockerLaunchPidPath, "utf8")
    .then(Number)
    .catch(() => 0);
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return (await readFile(`/proc/${pid}/comm`, "utf8")).trim() === "dockerd";
  } catch {
    return false;
  }
}

async function resetStaleDocker() {
  await shutdownDockerEngine();
}

function processCommand(
  executable: string,
  args: string[],
  environment: Record<string, string> = {},
) {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(executable, args, {
      env: { ...process.env, ...environment },
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  }).catch(() => 1);
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
