import assert from "node:assert/strict";
import test from "node:test";

import {
  createUserInstructionConfigService,
  resolvePluginSkillDirectoriesFromPaths,
} from "@cline/sdk";

import { blameNativePluginPath } from "./cline-runtime.js";

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
    assert.match(records[0]?.item.description ?? "", /frontend interface/);

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
    assert.match(output, /consult_specialist/);
  } finally {
    service.stop();
  }
});
