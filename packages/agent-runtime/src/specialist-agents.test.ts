import assert from "node:assert/strict";
import test from "node:test";

import {
  blameSpecialistAgentNames,
  blameSpecialistAgentsSystemPrompt,
} from "./specialist-agents.js";

test("defines the initial Blame specialist team", () => {
  assert.deepEqual(blameSpecialistAgentNames, [
    "Codebase Analyst",
    "Story Analyst",
    "Frontend Design Specialist",
    "Test & Verification Analyst",
    "Risk & Review Analyst",
  ]);
});

test("includes exact spawn prompts for every specialist", () => {
  const prompt = blameSpecialistAgentsSystemPrompt();

  for (const name of blameSpecialistAgentNames) {
    assert.match(prompt, new RegExp(`<system_prompt name="${name}">`));
  }

  assert.match(prompt, /spawn_agent tool/);
  assert.match(prompt, /Specialists are advisory by default/);
  assert.match(prompt, /Prefer 5 to 10 high-value bullets/);
  assert.equal(prompt.match(/## Specialist knowledge/g)?.length, 5);
  assert.match(prompt, /Jobs To Be Done/);
  assert.match(prompt, /entrypoint to side effect/);
  assert.match(prompt, /Gestalt grouping/);
  assert.match(prompt, /expand\/contract/);
  assert.match(prompt, /testing pyramid/);
  assert.match(prompt, /Signature detail/);
  assert.match(prompt, /Product grounding/);
});
