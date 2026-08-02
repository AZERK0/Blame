import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PreviewExecutionPlan, RuntimeSelection } from "@blame/preview-runtime";
import { runtimePaths } from "./runtime-paths.js";

export type RunnerRuntimeState = {
  engine?: "vercel-compose" | "vercel-process";
  plan?: PreviewExecutionPlan;
  prepared: boolean;
  running: boolean;
  servicePids: Record<string, number>;
  endpointRevision: number;
  browserBindingUrls: Record<string, string>;
  sessionId: string;
  generation: number;
  selection?: RuntimeSelection;
};

export async function readRuntimeState(): Promise<RunnerRuntimeState> {
  try {
    return JSON.parse(await readFile(runtimePaths.runtimeState, "utf8")) as RunnerRuntimeState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return initialRuntimeState();
  }
}

export async function writeRuntimeState(state: RunnerRuntimeState) {
  await mkdir(dirname(runtimePaths.runtimeState), { recursive: true, mode: 0o700 });
  const temporary = `${runtimePaths.runtimeState}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(state), { mode: 0o600, flush: true });
  await rename(temporary, runtimePaths.runtimeState);
}

export function initialRuntimeState(): RunnerRuntimeState {
  return {
    prepared: false,
    running: false,
    servicePids: {},
    endpointRevision: 0,
    browserBindingUrls: {},
    sessionId: "",
    generation: 0,
  };
}
