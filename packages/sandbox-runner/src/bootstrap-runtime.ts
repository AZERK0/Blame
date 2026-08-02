import { spawn } from "node:child_process";
import { chmod, chown, mkdir, open, readFile, writeFile } from "node:fs/promises";
import { runtimePaths } from "./runtime-paths.js";

const watcherPidPath = "/run/blame/journal-watcher.pid";

export async function bootstrapRuntime() {
  await ensureIdentity("blame-runtime", true);
  await ensureIdentity("blame-control", false);
  await ensureIdentity("blame-project", false);
  await addToGroup("blame-control", "blame-runtime");
  await addToGroup("blame-project", "blame-runtime");
  await setPrimaryGroup("blame-control", "blame-runtime");
  await setPrimaryGroup("blame-project", "blame-runtime");
  const control = await identity("blame-control");
  const project = await identity("blame-project");
  await mkdir(runtimePaths.workspace, { recursive: true, mode: 0o2770 });
  await chown(runtimePaths.workspace, project.uid, project.gid);
  await chmod(runtimePaths.workspace, 0o2770);
  for (const path of [
    runtimePaths.controlRoot,
    "/var/lib/blame/runtime",
    "/var/lib/blame/journal",
    runtimePaths.exports,
    "/var/log/blame",
    runtimePaths.logs,
  ]) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    await chown(path, control.uid, control.gid);
    await chmod(path, 0o700);
  }
  await mkdir(runtimePaths.requestDirectory, { recursive: true, mode: 0o700 });
  await chmod(runtimePaths.requestDirectory, 0o700);
  await ensureJournalWatcher();
}

async function ensureJournalWatcher() {
  try {
    const pid = Number(await readFile(watcherPidPath, "utf8"));
    if (Number.isSafeInteger(pid)) {
      process.kill(pid, 0);
      return;
    }
  } catch {}
  const log = await open("/var/log/blame/journal-watcher.log", "a", 0o600);
  const executable = process.argv[1];
  if (!executable) throw new Error("Runner executable path is unavailable.");
  const child = spawn(process.execPath, [executable, "watch-journal"], {
    detached: true,
    stdio: ["ignore", log.fd, log.fd],
  });
  child.unref();
  if (!child.pid) throw new Error("Unable to start workspace journal.");
  await writeFile(watcherPidPath, String(child.pid), { mode: 0o600, flush: true });
}

async function ensureIdentity(name: string, group: boolean) {
  if (await commandOk("getent", [group ? "group" : "passwd", name])) return;
  if (group) await requiredCommand("groupadd", ["--system", name]);
  else await requiredCommand("useradd", ["--system", "--create-home", "--shell", "/usr/sbin/nologin", name]);
}

async function addToGroup(user: string, group: string) {
  await requiredCommand("usermod", ["-a", "-G", group, user]);
}

async function setPrimaryGroup(user: string, group: string) {
  await requiredCommand("usermod", ["-g", group, user]);
}

async function identity(user: string) {
  return { uid: await idValue("-u", user), gid: await idValue("-g", user) };
}

function idValue(flag: string, user: string) {
  return commandOutput("id", [flag, user]).then((value) => Number(value.trim()));
}

function commandOk(command: string, args: string[]) {
  return commandResult(command, args).then(({ code }) => code === 0);
}

async function requiredCommand(command: string, args: string[]) {
  const result = await commandResult(command, args);
  if (result.code !== 0) throw new Error(`${command} failed.`);
}

function commandOutput(command: string, args: string[]) {
  return commandResult(command, args).then(({ code, stdout }) => {
    if (code !== 0) throw new Error(`${command} failed.`);
    return stdout;
  });
}

function commandResult(command: string, args: string[]) {
  return new Promise<{ code: number; stdout: string }>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code: code ?? 1, stdout }));
  });
}
