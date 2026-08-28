import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareChangeRequest } from "./change-request-capsule.js";
import { continuityProjectionHooks } from "./continuity-projection.js";
import type { ContinuityUpdate } from "./continuity-schema.js";
import {
  ConversationMemoryStore,
  renderedCapsuleTokens,
  utf8TokenUpperBound,
  type TokenCounter,
} from "./conversation-memory.js";
import { harnessFeatureEnabled } from "./harness-feature-flags.js";
import { sha256 } from "./protocol.js";
import { ReadWorkingSet } from "./read-working-set.js";

test("native completion preserves the summary without model-owned memory", async () => {
  await withMemory(async (root) => {
    const memory = new ConversationMemoryStore(root, "terminal");
    await memory.beginRequest({
      currentRequest: "Implement it.",
      userGoal: "Goal",
    });
    const result = await memory.completeNativeTurn(
      "Done.",
      "assistant-turn://completion-1",
    );
    assert.equal(result.answer, "Done.");
    assert.equal(result.metrics.continuity_fallback_used, true);
    assert.equal(
      (await memory.snapshot()).recentDialogue.at(-1)?.content,
      "Done.",
    );
  });
});

test("completion state is derived from runtime change and validation receipts", async () => {
  await withMemory(async (root) => {
    const memory = new ConversationMemoryStore(root, "validation-state");
    await memory.beginRequest({
      currentRequest: "Change it.",
      userGoal: "Goal",
    });
    await memory.recordChange({
      receiptId: "changeset://pending",
      files: ["notes.txt"],
      symbols: [],
      summary: "Updated notes.txt",
      validation: "skipped",
    });
    const pending = await memory.completionState();
    assert.equal(pending.dirtyChanges.length, 1);
    assert.equal(pending.coveredChanges.length, 0);
    assert.deepEqual(pending.requiredValidation?.files, ["notes.txt"]);
    await memory.recordValidation({
      id: "run://passed",
      status: "passed",
      terminal: "passed",
    });
    const covered = await memory.completionState();
    assert.equal(covered.coveredChanges.length, 1);
    assert.equal(covered.requiredValidation, undefined);
  });
});

test("continuity projection replaces the active request exactly once", async () => {
  await withMemory(async (root) => {
    const memory = new ConversationMemoryStore(root, "projection");
    const request = "Keep the API stable and update src/example.ts.";
    await memory.beginRequest({ currentRequest: request, userGoal: "Goal" });
    await memory.recordChange({
      receiptId: "changeset://opaque",
      sourceRevisionId: "src_opaque",
      files: ["src/example.ts"],
      symbols: ["example"],
      summary: "Updated example",
      validation: "passed",
    });
    const hook = continuityProjectionHooks(memory).beforeModel;
    assert.ok(hook);
    const projected = await hook({
      request: {
        messages: [
          {
            id: "user",
            role: "user",
            content: [{ type: "text", text: request }],
            createdAt: 1,
          },
          {
            id: "assistant",
            role: "assistant",
            content: [{ type: "text", text: "Working" }],
            createdAt: 2,
          },
          {
            id: "native-completion-policy",
            role: "user",
            content: [{ type: "text", text: "[SYSTEM] Use submit_and_exit." }],
            createdAt: 3,
          },
        ],
        tools: [],
      },
      snapshot: { iteration: 3 },
    } as never);
    const serialized = JSON.stringify(projected?.messages);
    assert.equal(serialized.split(request).length - 1, 1);
    assert.match(serialized, /<blame_continuity>/);
    assert.match(serialized, /\[SYSTEM\] Use submit_and_exit\./);
    assert.doesNotMatch(serialized, /changeset:\/\/|src_opaque/);
    const restarted = new ConversationMemoryStore(root, "projection");
    assert.equal((await restarted.runtimeContinuity()).activeRequest, request);
  });
});

test("the production beforeModel hook detects compaction and releases stale read coverage", async () => {
  await withMemory(async (root) => {
    const conversationId = "real-compaction-hook";
    const request = "Preserve the objective while compacting.";
    const memory = new ConversationMemoryStore(root, conversationId);
    await memory.beginRequest({ currentRequest: request, userGoal: request });
    const workingSet = new ReadWorkingSet(root, conversationId);
    await workingSet.register({
      contextEpoch: await memory.currentEpochId(),
      maximumBytes: 32,
      path: "src/known.ts",
      range: [0, 16],
      sourceBlob: "blob-known",
      sourceContent: Buffer.from("export const x=1"),
      view: "raw",
    });
    await memory.recordKnowledge(
      ["inspect_code identified symbols: importantHandler."],
      "src/known.ts",
    );
    const hook = continuityProjectionHooks(memory).beforeModel;
    assert.ok(hook);
    const longTranscript = [
      {
        id: "user",
        role: "user",
        content: [{ type: "text", text: request }],
        createdAt: 1,
      },
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `assistant-${index}`,
        role: "assistant",
        content: [{ type: "text", text: "learned context ".repeat(200) }],
        createdAt: index + 2,
      })),
    ];
    await hook({ request: { messages: longTranscript, tools: [] } } as never);
    const projected = await hook({
      request: {
        messages: [
          {
            id: "user-compacted",
            role: "user",
            content: [{ type: "text", text: request }],
            createdAt: 20,
          },
          {
            id: "summary",
            role: "assistant",
            content: [{ type: "text", text: "Compacted summary." }],
            createdAt: 21,
          },
        ],
        tools: [],
      },
    } as never);

    const snapshot = await memory.snapshot();
    assert.equal(
      snapshot.evidence.some(
        (event) =>
          event.type === "runtime_event" && event.event === "compaction",
      ),
      true,
    );
    assert.equal(
      (await workingSet.list())[0]?.content_in_active_context,
      false,
    );
    assert.match(
      JSON.stringify(projected?.messages),
      /importantHandler|src\/known\.ts/u,
    );
  });
});

test("a later validated CSS edit cannot hide an unvalidated Prisma edit", async () => {
  await withMemory(async (root) => {
    const memory = new ConversationMemoryStore(root, "validation-history");
    await memory.beginRequest({
      currentRequest: "Update Prisma and the stylesheet.",
      userGoal: "Implement the feature.",
    });
    await memory.recordChange({
      receiptId: "changeset://prisma",
      files: ["prisma/schema.prisma"],
      symbols: [],
      summary: "Updated Prisma schema",
      validation: "not_supported",
    });
    await memory.recordChange({
      receiptId: "changeset://css",
      files: ["src/app.css"],
      symbols: [".card"],
      summary: "Updated card style",
      validation: "passed",
    });
    const blocked = await memory.completionState();
    assert.deepEqual(blocked.requiredValidation?.files, [
      "prisma/schema.prisma",
      "src/app.css",
    ]);
    assert.equal(blocked.requiredValidation?.reason, "prisma");
    await memory.recordValidation({
      command: "node scripts/check-copy.mjs",
      id: "run://unrelated-custom",
      status: "passed",
      taskId: "check-copy",
      taskKind: "custom",
      terminal: "passed",
    });
    assert.ok((await memory.completionState()).requiredValidation);
    await memory.recordValidation({
      command: "prisma validate",
      id: "run://prisma",
      status: "passed",
      taskId: "prisma:validate",
      taskKind: "custom",
      terminal: "passed",
    });
    assert.ok((await memory.completionState()).requiredValidation);
    await memory.recordValidation({
      id: "run://build",
      status: "passed",
      taskId: "build",
      taskKind: "build",
      terminal: "passed",
    });
    assert.equal(
      (await memory.completionState()).requiredValidation,
      undefined,
    );
  });
});

test("multi-file changes require a relevant run after the last write", async () => {
  await withMemory(async (root) => {
    const memory = new ConversationMemoryStore(root, "multi-validation");
    await memory.beginRequest({
      currentRequest: "Implement it.",
      userGoal: "Feature",
    });
    await memory.recordChange({
      receiptId: "changeset://multi",
      sourceRevisionId: "revision-final",
      files: ["src/api/route.ts", "src/page.tsx"],
      symbols: [],
      summary: "Updated API and UI",
      validation: "passed",
    });
    assert.ok((await memory.completionState()).requiredValidation);
    await memory.recordValidation({
      id: "run://stale-build",
      sourceRevisionId: "revision-before-edit",
      status: "passed",
      taskId: "build",
      taskKind: "build",
      terminal: "passed",
    });
    assert.ok((await memory.completionState()).requiredValidation);
    await memory.recordValidation({
      id: "run://build",
      sourceRevisionId: "revision-final",
      status: "passed",
      taskId: "build",
      taskKind: "build",
      terminal: "passed",
    });
    assert.equal(
      (await memory.completionState()).requiredValidation,
      undefined,
    );
  });
});

test("separate single-file edits require a later feature validation", async () => {
  await withMemory(async (root) => {
    const memory = new ConversationMemoryStore(root, "multi-file-turn");
    await memory.beginRequest({
      currentRequest: "Update two files",
      userGoal: "Update",
    });
    await memory.recordChange({
      receiptId: "changeset://first",
      files: ["src/first.ts"],
      symbols: ["first"],
      summary: "first",
      validation: "passed",
    });
    await memory.recordChange({
      receiptId: "changeset://second",
      files: ["src/second.ts"],
      symbols: ["second"],
      summary: "second",
      validation: "passed",
    });
    const readiness = await memory.completionState();
    assert.deepEqual(readiness.requiredValidation?.files, [
      "src/first.ts",
      "src/second.ts",
    ]);
    await memory.recordValidation({
      id: "run://typecheck",
      status: "passed",
      taskKind: "typecheck",
      terminal: "passed",
    });
    assert.equal(
      (await memory.completionState()).requiredValidation,
      undefined,
    );
  });
});

test("a user constraint survives twenty turns and compactions", async () => {
  await withMemory(async (root) => {
    const memory = new ConversationMemoryStore(root, "twenty-turns");
    await memory.beginRequest({
      currentRequest: "Keep the mobile title blue.",
      userGoal: "Improve the portfolio.",
    });
    for (let index = 0; index < 20; index += 1) {
      await memory.rotate("model_compaction", 500);
      await memory.beginRequest({
        currentRequest: `Iteration ${index}`,
        userGoal: "Improve the portfolio.",
        maximumTokens: 500,
      });
    }
    const snapshot = await memory.snapshot();
    assert.equal(
      snapshot.facts.some(
        (fact) =>
          fact.authority === "user" && fact.text.includes("mobile title blue"),
      ),
      true,
    );
  });
});

test("an explicit replacement preserves the previous user fact", async () => {
  await withMemory(async (root) => {
    const memory = new ConversationMemoryStore(root, "replacement");
    await memory.beginRequest({
      currentRequest: "Keep the title blue.",
      userGoal: "Improve title styling.",
    });
    await memory.beginRequest({
      currentRequest: "Finally, keep the title black.",
      userGoal: "Improve title styling.",
    });
    const snapshot = await memory.snapshot();
    const blue = snapshot.facts.find((fact) =>
      fact.text.includes("title blue"),
    );
    const black = snapshot.facts.find((fact) =>
      fact.text.includes("title black"),
    );
    assert.equal(blue?.status, "superseded");
    assert.equal(blue?.superseded_by, black?.id);
    const recalled = await memory.recall({ query: "previous title color" });
    assert.equal(
      recalled.facts.some((fact) => fact.id === blue?.id),
      true,
    );
  });
});

test("agent interpretation cannot supersede an explicit user fact", async () => {
  await withMemory(async (root) => {
    const memory = new ConversationMemoryStore(root, "authority");
    await memory.beginRequest({
      currentRequest: "Never remove accessibility labels.",
      userGoal: "Accessible interface.",
    });
    const fact = (await memory.snapshot()).facts[0];
    assert.ok(fact);
    const update = {
      ...emptyUpdate(),
      facts_superseded: [
        { fact_id: fact.id, reason: "Agent changed direction." },
      ],
    } satisfies ContinuityUpdate;
    const completion = await memory.completeTurn({
      answer: "Done.",
      continuityUpdate: update,
      completionRef: "assistant-turn://authority",
    });
    assert.equal(completion.metrics.memory_merge_conflict_count, 1);
    assert.equal((await memory.snapshot()).facts[0]?.status, "active");
  });
});

test("fake receipts and unsupported technical claims are rejected", async () => {
  await withMemory(async (root) => {
    const memory = new ConversationMemoryStore(root, "false-receipt");
    await memory.beginRequest({
      currentRequest: "Run tests.",
      userGoal: "Verify",
    });
    const update = {
      ...emptyUpdate(),
      change_receipt_refs: ["changeset://missing"],
      facts_added: [
        {
          kind: "decision",
          text: "The tests passed successfully.",
          scope: { type: "global" },
          durability: "story",
          evidence_refs: ["run://missing"],
        },
      ],
    } satisfies ContinuityUpdate;
    const completion = await memory.completeTurn({
      answer: "Validation unavailable.",
      continuityUpdate: update,
      completionRef: "assistant-turn://false-receipt",
    });
    assert.equal(completion.metrics.invalid_evidence_ref_count, 2);
    assert.equal(completion.metrics.memory_merge_conflict_count, 1);
    assert.equal((await memory.snapshot()).facts.length, 0);
  });
});

test("identical deltas are idempotent across turns", async () => {
  await withMemory(async (root) => {
    const memory = new ConversationMemoryStore(root, "delta-idempotency");
    const update = {
      ...emptyUpdate(),
      facts_added: [
        {
          kind: "decision",
          text: "Use lexical retrieval first.",
          scope: { type: "feature", value: "memory" },
          durability: "conversation",
        },
      ],
    } satisfies ContinuityUpdate;
    await memory.beginRequest({ currentRequest: "First.", userGoal: "Memory" });
    await memory.completeTurn({
      answer: "First done.",
      continuityUpdate: update,
      completionRef: "assistant-turn://first",
    });
    await memory.beginRequest({
      currentRequest: "Second.",
      userGoal: "Memory",
    });
    await memory.completeTurn({
      answer: "Second done.",
      continuityUpdate: {
        ...update,
        facts_added: [
          {
            ...update.facts_added[0]!,
            text: "Utilise lexical retrieval first",
          },
        ],
      },
      completionRef: "assistant-turn://second",
    });
    const facts = (await memory.snapshot()).facts.filter(
      (fact) => fact.kind === "decision" && fact.scope.value === "memory",
    );
    assert.equal(facts.length, 1);
  });
});

test("fallback checkpoints preserve runtime receipts after interruption", async () => {
  await withMemory(async (root) => {
    const memory = new ConversationMemoryStore(root, "interruption");
    await memory.beginRequest({
      currentRequest: "Apply and test.",
      userGoal: "Goal",
    });
    await memory.recordChange({
      receiptId: "changeset://applied",
      files: ["src/a.ts"],
      symbols: ["a"],
      summary: "Applied change",
      validation: "pending",
    });
    await memory.recordValidation({
      id: "run://passed",
      taskId: "test",
      status: "passed",
      terminal: "passed",
    });
    assert.equal(await memory.ensureDeterministicFallback(true), true);
    const fallback = (await memory.snapshot()).fallbackCheckpoints[0];
    assert.deepEqual(fallback?.applied_change_refs, ["changeset://applied"]);
    assert.deepEqual(fallback?.run_refs, ["run://passed"]);
    assert.equal(fallback?.interrupted, true);
  });
});

test("the current request is exact, unique, and outside a hard-bounded capsule", async () => {
  await withMemory(async (root) => {
    const memory = new ConversationMemoryStore(root, "capsule-budget");
    for (let index = 0; index < 30; index += 1)
      await memory.beginRequest({
        currentRequest: `Keep constraint ${index} with a deliberately verbose value for the capsule.`,
        userGoal: "A deliberately verbose user goal that remains stable.",
      });
    const request = "  Keep this exact request.\nDo not normalize it.  ";
    const prepared = await prepareChangeRequest({
      conversationId: "capsule-budget",
      newRequest: request,
      storySummary: "A deliberately verbose user goal that remains stable.",
      storyTitle: "Memory",
      workspaceRoot: root,
      maximumTokens: 500,
    });
    assert.equal(prepared.prompt.split(request).length - 1, 1);
    assert.equal(
      (prepared.capsule as unknown as { currentRequest?: string })
        .currentRequest,
      undefined,
    );
    assert.equal(JSON.stringify(prepared.capsule).includes(request), false);
    assert.ok(renderedCapsuleTokens(prepared.capsule) <= 500);
    assert.ok(prepared.outputTokens <= 500);
    assert.equal(prepared.tokenCountingStrategy, "utf8_upper_bound");
    assert.ok(
      Buffer.byteLength(
        `<continuity_capsule>\n${JSON.stringify(prepared.capsule)}\n</continuity_capsule>`,
        "utf8",
      ) <= 500,
    );
  });
});

test("capsule budgets accept a provider tokenizer without weakening the cap", async () => {
  await withMemory(async (root) => {
    const tokenCounter: TokenCounter = {
      strategy: "provider_tokenizer",
      count: (text) => Math.ceil(text.length / 3),
    };
    const memory = new ConversationMemoryStore(
      root,
      "provider-tokenizer",
      tokenCounter,
    );
    await memory.beginRequest({
      currentRequest: "Keep the mobile title blue.",
      userGoal: "Portfolio",
    });
    const prepared = await prepareChangeRequest({
      conversationId: "provider-tokenizer",
      newRequest: "Increase the spacing.",
      storySummary: "Portfolio",
      storyTitle: "Memory",
      workspaceRoot: root,
      maximumTokens: 500,
      tokenCounter,
    });
    assert.equal(prepared.tokenCountingStrategy, "provider_tokenizer");
    assert.ok(renderedCapsuleTokens(prepared.capsule, tokenCounter) <= 500);
    assert.ok(prepared.capsule.relevantConstraints.length > 0);
    assert.ok(utf8TokenUpperBound.count("é") >= tokenCounter.count("é"));
  });
});

test("the current request is not duplicated when it is also the story goal", async () => {
  await withMemory(async (root) => {
    const request = "Keep the title blue.";
    const prepared = await prepareChangeRequest({
      conversationId: "same-goal-request",
      newRequest: request,
      storySummary: request,
      storyTitle: "",
      workspaceRoot: root,
      maximumTokens: 500,
    });
    assert.equal(prepared.prompt.split(request).length - 1, 1);
    assert.equal(JSON.stringify(prepared.capsule).includes(request), false);
  });
});

test("recall prioritizes exact receipts, files, symbols, and lexical synonyms", async () => {
  await withMemory(async (root) => {
    const memory = new ConversationMemoryStore(root, "recall");
    await memory.beginRequest({
      currentRequest: "Keep the mobile title blue.",
      userGoal: "Portfolio",
    });
    await memory.recordChange({
      receiptId: "changeset://title",
      files: ["src/title.css"],
      symbols: ["sym://title"],
      summary: "Changed the heading colour.",
      validation: "passed",
    });
    const exact = await memory.recall({
      change_receipt_id: "changeset://title",
    });
    const lexical = await memory.recall({ query: "heading colour" });
    const structural = await memory.recall({
      file_path: "src/title.css",
      symbol_ref: "sym://title",
    });
    assert.equal(exact.retrieval_strategy, "exact");
    assert.equal(exact.changes[0]?.id, "changeset://title");
    assert.equal(
      lexical.facts.some((fact) => fact.text.includes("title blue")),
      true,
    );
    assert.equal(structural.changes[0]?.id, "changeset://title");
  });
});

test("recall searches bounded historical user evidence beyond recent dialogue", async () => {
  await withMemory(async (root) => {
    const conversationId = "historical-user-evidence";
    const memory = new ConversationMemoryStore(root, conversationId);
    const preference = "J’aime les transitions sobres sur la page d’accueil.";
    await memory.beginRequest({
      currentRequest: preference,
      userGoal: "Portfolio",
    });
    for (let index = 0; index < 8; index += 1)
      await memory.beginRequest({
        currentRequest: `Ajustement indépendant ${index}.`,
        userGoal: "Portfolio",
      });
    const snapshot = await memory.snapshot();
    assert.equal(
      snapshot.recentDialogue.some((turn) => turn.content === preference),
      false,
    );
    assert.equal(
      snapshot.facts.some((fact) => fact.text === preference),
      false,
    );
    const restarted = new ConversationMemoryStore(root, conversationId);
    const recalled = await restarted.recall({ query: "transitions sobres" });
    assert.equal(
      recalled.dialogue.some((turn) => turn.content === preference),
      true,
    );
    assert.ok(recalled.candidate_count >= recalled.returned_count);
  });
});

test("version 1 memory migrates without destructive rewrite", async () => {
  await withMemory(async (root) => {
    const conversationId = "legacy";
    const identity = sha256(conversationId);
    const directory = join(root, ".blame", "harness", "conversation-memory");
    const path = join(directory, `${identity}.json`);
    await mkdir(directory, { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        schema_version: "1.0",
        memory: {
          conversationId,
          userGoal: "Legacy goal",
          currentIntent: "Keep legacy behavior.",
          persistentConstraints: [
            {
              id: "legacy-fact",
              value: "Keep legacy behavior.",
              updatedAt: new Date(0).toISOString(),
            },
          ],
          acceptedDecisions: [],
          rejectedDirections: [],
          completedChanges: [],
          unresolvedItems: [],
          validationState: {
            status: "unknown",
            checks: [],
            updatedAt: new Date(0).toISOString(),
          },
          recentDialogue: [],
          updatedAt: new Date(0).toISOString(),
        },
        epoch: {
          id: "legacy:epoch:1",
          sequence: 1,
          reason: "legacy",
          startedAt: new Date(0).toISOString(),
        },
      }),
    );
    const memory = new ConversationMemoryStore(root, conversationId);
    assert.equal(
      (await memory.snapshot()).facts[0]?.text,
      "Keep legacy behavior.",
    );
    await memory.rotate("model_compaction");
    const persisted = JSON.parse(await readFile(path, "utf8")) as {
      schema_version: string;
    };
    assert.equal(persisted.schema_version, "2.0");
  });
});

test("memory feature flags are independent and embeddings default off", () => {
  assert.equal(harnessFeatureEnabled("BLAME_NATIVE_CLINE_HARNESS", {}), true);
  assert.equal(
    harnessFeatureEnabled("BLAME_NATIVE_CLINE_HARNESS", {
      BLAME_NATIVE_CLINE_HARNESS: "false",
    }),
    false,
  );
  assert.equal(harnessFeatureEnabled("BLAME_MEMORY_AUTHORITY_V2", {}), true);
  assert.equal(harnessFeatureEnabled("BLAME_HARD_CAPSULE_BUDGET", {}), true);
  assert.equal(harnessFeatureEnabled("BLAME_SEMANTIC_RECALL", {}), true);
  assert.equal(harnessFeatureEnabled("BLAME_OPENROUTER_EMBEDDINGS", {}), false);
  assert.equal(
    harnessFeatureEnabled("BLAME_OPENROUTER_EMBEDDINGS", {
      BLAME_OPENROUTER_EMBEDDINGS: "true",
    }),
    true,
  );
});

function emptyUpdate(): ContinuityUpdate {
  return {
    schema_version: "1.0",
    facts_added: [],
    facts_superseded: [],
    items_resolved: [],
    change_receipt_refs: [],
  };
}

async function withMemory(operation: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "blame-memory-"));
  try {
    await operation(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
