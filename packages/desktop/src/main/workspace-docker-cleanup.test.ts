import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  cleanupAbandonedBlamePreviews,
  dockerAddressPoolExhausted,
} from "./workspace-docker-cleanup.ts";

test("detects Docker address pool exhaustion", () => {
  assert.equal(
    dockerAddressPoolExhausted({
      stderr:
        "failed to create network preview_default: Error response from daemon: all predefined address pools have been fully subnetted",
    }),
    true,
  );
  assert.equal(dockerAddressPoolExhausted(new Error("connection reset")), false);
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
    return { stdout: "" };
  };

  const cleaned = await cleanupAbandonedBlamePreviews({ exec });

  assert.deepEqual(cleaned, ["blame_abandoned"]);
  assert.ok(callIncludes(calls, ["rm", "stopped"]));
  assert.ok(callIncludes(calls, ["rm", "stopped-deps"]));
  assert.ok(callIncludes(calls, ["network", "rm", "network-abandoned"]));
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
  assert.equal(callIncludes(calls, ["rm", "stopped"]), false);
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
  return calls.some((call) => expected.every((part) => call.args.includes(part)));
}
