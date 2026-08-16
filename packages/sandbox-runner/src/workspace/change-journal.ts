import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { runtimePaths } from "../runtime-paths.js";
import { snapshotWorkspace, type WorkspaceSnapshot } from "./workspace-snapshot.js";

export type ChangeJournalState = {
  revision: number;
  base: WorkspaceSnapshot;
  current: WorkspaceSnapshot;
  updatedAt: string;
};

export async function initializeChangeJournal() {
  return withJournalLock(async () => {
    const snapshot = await snapshotWorkspace();
    const state = {
      revision: 0,
      base: snapshot,
      current: snapshot,
      updatedAt: new Date().toISOString(),
    } satisfies ChangeJournalState;
    await writeJournal(state);
    return state;
  });
}

export async function checkpointChangeJournal() {
  return withJournalLock(async () => {
    const current = await snapshotWorkspace();
    const state = await readChangeJournal().catch(() => ({
      revision: 0,
      base: current,
      current,
      updatedAt: new Date().toISOString(),
    }));
    if (state.current.hash !== current.hash) {
      state.revision += 1;
      state.current = current;
      state.updatedAt = new Date().toISOString();
      await writeJournal(state);
    }
    return state;
  });
}

export async function readChangeJournal(): Promise<ChangeJournalState> {
  return JSON.parse(await readFile(runtimePaths.journal, "utf8")) as ChangeJournalState;
}

export async function acknowledgeChangeJournal(revision: string) {
  return withJournalLock(async () => {
    const state = await readChangeJournal();
    if (String(state.revision) !== revision) {
      throw new Error("Only the latest exported workspace revision can be acknowledged.");
    }
    state.base = state.current;
    state.updatedAt = new Date().toISOString();
    await writeJournal(state);
    return state;
  });
}

export async function watchChangeJournal() {
  while (true) {
    try {
      await checkpointChangeJournal();
    } catch {}
    await delay(2_000);
  }
}

async function writeJournal(state: ChangeJournalState) {
  await mkdir(dirname(runtimePaths.journal), { recursive: true, mode: 0o700 });
  const temporary = `${runtimePaths.journal}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(state), { mode: 0o600, flush: true });
  await rename(temporary, runtimePaths.journal);
}

async function withJournalLock<T>(operation: () => Promise<T>) {
  await mkdir(dirname(runtimePaths.journalLock), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const lock = await open(runtimePaths.journalLock, "wx", 0o600);
      try {
        await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
        await lock.sync();
        return await operation();
      } finally {
        await lock.close();
        await rm(runtimePaths.journalLock, { force: true });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await recoverStaleJournalLock();
      await delay(20);
    }
  }
  throw new Error("Change journal lock timed out.");
}

async function recoverStaleJournalLock() {
  try {
    const [content, metadata] = await Promise.all([
      readFile(runtimePaths.journalLock, "utf8"),
      stat(runtimePaths.journalLock),
    ]);
    const owner = JSON.parse(content) as { pid?: unknown; createdAt?: unknown };
    const pid = Number(owner.pid);
    const createdAt = Number(owner.createdAt);
    const implausiblyOld = Date.now() - Math.min(createdAt || metadata.mtimeMs, metadata.mtimeMs) > 10 * 60_000;
    if (!Number.isSafeInteger(pid) || pid < 1 || !processAlive(pid) || implausiblyOld) {
      await rm(runtimePaths.journalLock, { force: true });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    const metadata = await stat(runtimePaths.journalLock).catch(() => undefined);
    if (metadata && Date.now() - metadata.mtimeMs > 30_000) {
      await rm(runtimePaths.journalLock, { force: true });
    }
  }
}

function processAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
