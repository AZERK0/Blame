import assert from "node:assert/strict";
import test from "node:test";

import {
  createUserInstructionConfigService,
  resolvePluginSkillDirectoriesFromPaths,
  type UserInstructionConfigService,
} from "@cline/sdk";

import { blameNativePluginPath } from "./cline-runtime.js";
import { BlameUserInstructionServices } from "./user-instruction-services.js";

test("discovers and invokes Impeccable through Cline native skills", async () => {
  const skillDirectories = resolvePluginSkillDirectoriesFromPaths([
    blameNativePluginPath(),
  ]);
  assert.equal(skillDirectories.length, 1);
  assert.match(skillDirectories[0] ?? "", /blame-native\/skills$/);

  const service = createUserInstructionConfigService({
    skills: { directories: skillDirectories },
  });
  try {
    await service.start();
    const records = service.listRecords("skill");
    assert.equal(records.length, 1);
    assert.equal(records[0]?.item.name, "impeccable");
    assert.match(records[0]?.item.description ?? "", /frontend task/);
    assert.match(records[0]?.item.description ?? "", /Mandatory/);
    assert.match(records[0]?.item.description ?? "", /before making design/);

    const executor = service.createSkillsExecutor?.();
    assert.ok(executor);
    assert.deepEqual(
      executor.configuredSkills?.map((skill: { name: string }) => skill.name),
      ["impeccable"],
    );
    const output = await executor("impeccable", "polish settings", {} as never);
    assert.match(output, /<command-name>impeccable<\/command-name>/);
    assert.match(output, /<command-args>polish settings<\/command-args>/);
    assert.match(output, /# Impeccable for Blame/);
    assert.match(output, /hard precondition/);
    assert.match(output, /consult_specialist/);
  } finally {
    service.stop();
  }
});

test("keeps session startup available when the skill service fails", async () => {
  let stopped = false;
  const services = new BlameUserInstructionServices(
    () =>
      ({
        async start() {
          throw new Error("skill watcher unavailable");
        },
        stop() {
          stopped = true;
        },
      }) as UserInstructionConfigService,
  );

  const service = await services.start({
    cwd: "/tmp/blame-skill-fallback",
    pluginPaths: ["/tmp/blame-native/index.js"],
    sessionId: "fallback-session",
    workspaceRoot: "/tmp/blame-skill-fallback",
  });

  assert.equal(service, undefined);
  assert.equal(stopped, true);
});
