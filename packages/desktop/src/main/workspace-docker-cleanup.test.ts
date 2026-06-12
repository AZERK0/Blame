import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  cleanupAbandonedBlamePreviews,
  removeBlamePreviewProjectResources,
  runtimeAddressPoolExhausted,
} from "./workspace-docker-cleanup.ts";

test("detects runtime address pool exhaustion", () => {
  assert.equal(
    runtimeAddressPoolExhausted({
      stderr:
        "failed to create network preview_default: Error response from daemon: all predefined address pools have been fully subnetted",
    }),
    true,
  );
  assert.equal(
    runtimeAddressPoolExhausted(new Error("connection reset")),
    false,
  );
});

test("removes stopped Blame preview containers and their unused networks", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const containers = [
    container("stopped", "blame_abandoned", false, true),
    container("stopped-deps", "blame_abandoned", false, false),
    container("running", "blame_active", true, true),
    container("external", "external_project", false, false),
  ];
  const networks = [
    {
      Id: "network-abandoned",
      Name: "blame_abandoned_default",
      Labels: { "com.docker.compose.project": "blame_abandoned" },
      Containers: {},
    },
  ];
  const exec = async (file: string, args: string[]) => {
    calls.push({ file, args });
    if (args[0] === "ps")
      return { stdout: "stopped\nstopped-deps\nrunning\nexternal\n" };
    if (args[0] === "inspect" && args.includes("stopped"))
      return { stdout: JSON.stringify(containers) };
    if (args[0] === "network" && args[1] === "ls")
      return { stdout: "network-abandoned\n" };
    if (args[0] === "inspect" && args.includes("network-abandoned"))
      return { stdout: JSON.stringify(networks) };
    if (args[0] === "volume" && args[1] === "ls")
      return {
        stdout:
          "blame_abandoned_node_modules\nblame_abandoned_db_data\nblame_pnpm_store\n",
      };
    return { stdout: "" };
  };

  const cleaned = await cleanupAbandonedBlamePreviews({ exec });

  assert.deepEqual(cleaned, ["blame_abandoned"]);
  assert.ok(callIncludes(calls, ["rm", "stopped"]));
  assert.ok(callIncludes(calls, ["rm", "stopped-deps"]));
  assert.ok(callIncludes(calls, ["network", "rm", "network-abandoned"]));
  assert.ok(
    callIncludes(calls, [
      "volume",
      "rm",
      "blame_abandoned_node_modules",
      "blame_abandoned_db_data",
    ]),
  );
  assert.equal(callIncludes(calls, ["volume", "rm", "blame_pnpm_store"]), false);
  assert.equal(callIncludes(calls, ["rm", "running"]), false);
  assert.equal(callIncludes(calls, ["rm", "external"]), false);
});

test("uses compose down when the original compose file still exists", async () => {
  const directory = await mkdtemp(join(tmpdir(), "blame-compose-"));
  const composeFile = join(directory, "docker-compose.yml");
  await writeFile(composeFile, "services: {}\n", "utf8");
  const calls: Array<{ file: string; args: string[] }> = [];
  const exec = async (file: string, args: string[]) => {
    calls.push({ file, args });
    if (args[0] === "ps") return { stdout: "stopped\n" };
    if (args[0] === "inspect" && args.includes("stopped"))
      return {
        stdout: JSON.stringify([
          container("stopped", "blame_abandoned", false, true, composeFile),
        ]),
      };
    if (args[0] === "volume" && args[1] === "ls")
      return {
        stdout:
          "blame_abandoned_node_modules\nblame_abandoned_pnpm_store\nblame_pnpm_store\nother_volume\n",
      };
    if (args[0] === "network" && args[1] === "ls") return { stdout: "" };
    return { stdout: "" };
  };

  const cleaned = await cleanupAbandonedBlamePreviews({ exec });

  assert.deepEqual(cleaned, ["blame_abandoned"]);
  assert.ok(
    callIncludes(calls, [
      "compose",
      "-f",
      composeFile,
      "--project-directory",
      directory,
      "-p",
      "blame_abandoned",
      "down",
      "--remove-orphans",
    ]),
  );
  assert.ok(
    callIncludes(calls, ["volume", "rm", "blame_abandoned_node_modules"]),
  );
  assert.ok(
    callIncludes(calls, ["volume", "rm", "blame_abandoned_pnpm_store"]),
  );
  assert.equal(
    callIncludes(calls, ["volume", "rm", "blame_pnpm_store"]),
    false,
  );
  assert.equal(callIncludes(calls, ["rm", "stopped"]), false);
});

test("removes resources for an explicitly deleted worktree project", async () => {
  const project = "blame_123456abcdef";
  const calls: Array<{ file: string; args: string[] }> = [];
  const exec = async (file: string, args: string[]) => {
    calls.push({ file, args });
    if (args[0] === "ps") return { stdout: "running\n" };
    if (args[0] === "inspect" && args.includes("running"))
      return { stdout: JSON.stringify([container("running", project, true, true)]) };
    if (args[0] === "volume" && args[1] === "ls")
      return { stdout: `${project}_node_modules\nblame_pnpm_store\n` };
    return { stdout: "" };
  };

  const removed = await removeBlamePreviewProjectResources(project, { exec });

  assert.equal(removed, true);
  assert.ok(callIncludes(calls, ["rm", "--force", "running"]));
  assert.ok(callIncludes(calls, ["volume", "rm", `${project}_node_modules`]));
  assert.equal(callIncludes(calls, ["volume", "rm", "blame_pnpm_store"]), false);
});

function container(
  id: string,
  project: string,
  running: boolean,
  preview: boolean,
  composeFile = "",
) {
  return {
    Id: id,
    Config: {
      Labels: {
        ...(preview ? { "blame.preview": "true" } : {}),
        "com.docker.compose.project": project,
        "com.docker.compose.project.config_files": composeFile,
        "com.docker.compose.project.working_dir": composeFile
          ? composeFile.replace(/\/docker-compose\.yml$/, "")
          : "",
      },
    },
    State: { Running: running },
  };
}

function callIncludes(calls: Array<{ args: string[] }>, expected: string[]) {
  return calls.some((call) =>
    expected.every((part) => call.args.includes(part)),
  );
}
