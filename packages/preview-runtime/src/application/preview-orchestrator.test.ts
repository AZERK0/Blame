import assert from "node:assert/strict";
import test from "node:test";
import { compilePreviewManifest } from "../compilation/manifest-compiler.js";
import { PreviewRuntimeError } from "../domain/preview-errors.js";
import {
  FakePreviewRuntimeDriver,
  InMemoryDistributedLock,
  InMemoryPreviewEventSink,
  InMemorySessionRepository,
} from "../testing/in-memory-adapters.js";
import { PreviewOrchestrator } from "./preview-orchestrator.js";
import { PreviewReconciler } from "./preview-reconciler.js";

function fixture() {
  const plan = compilePreviewManifest({
    confidence: "high",
    project: {},
    setup: [],
    services: [
      {
        id: "web",
        kind: "preview",
        container: { image: "node:24" },
        command: "pnpm dev",
        endpoints: [
          {
            id: "http",
            protocol: "http",
            port: 3000,
            healthcheck: { type: "http", path: "/", timeoutMs: 30000 },
          },
        ],
      },
    ],
    caches: [],
    risks: [],
    probes: [],
  });
  const repository = new InMemorySessionRepository();
  const eventSink = new InMemoryPreviewEventSink();
  const driver = new FakePreviewRuntimeDriver();
  const reconciler = new PreviewReconciler({
    repository,
    eventSink,
    drivers: new Map([[driver.profile, driver]]),
  });
  const orchestrator = new PreviewOrchestrator(
    repository,
    new InMemoryDistributedLock(),
    eventSink,
    reconciler,
  );
  return { driver, orchestrator, plan, repository };
}

test("requires cloud upload consent", async () => {
  const { orchestrator, plan } = fixture();
  await assert.rejects(
    () =>
      orchestrator.create({
        id: "session",
        userStoryId: "story",
        ownerUserId: "owner",
        profile: "vercel-compose",
        plan,
        planHash: "hash",
      }),
    (error) =>
      error instanceof PreviewRuntimeError &&
      error.failure.code === "PREVIEW_ACCESS_DENIED",
  );
});

test("runs commands idempotently and keeps state axes independent", async () => {
  const { driver, orchestrator, plan, repository } = fixture();
  await orchestrator.create({
    id: "session",
    userStoryId: "story",
    ownerUserId: "owner",
    profile: "vercel-compose",
    plan,
    planHash: "hash",
    cloudUploadConsentAt: new Date().toISOString(),
  });
  const first = await orchestrator.command(
    "session",
    { type: "start-services", configurationId: "dev" },
    "operation",
  );
  const second = await orchestrator.command(
    "session",
    { type: "start-services", configurationId: "dev" },
    "operation",
  );
  assert.equal(first.state.engine, "running");
  assert.equal(first.state.preview, "ready");
  assert.equal(first.state.agent, "idle");
  assert.equal(second.revision, first.revision);
  assert.equal("fencingToken" in first, false);
  assert.ok((await repository.get("session"))!.fencingToken >= 2);
  assert.equal(
    driver.calls.filter((call) => call === "startPreview").length,
    1,
  );
  assert.equal(
    driver.calls.filter((call) => call === "prepareEngine").length,
    0,
  );
  assert.equal(
    driver.calls.filter((call) => call === "startServices").length,
    0,
  );
  assert.equal(driver.calls.filter((call) => call === "endpoints").length, 0);
});

test("does not claim that a managed agent is running without a remote executor", async () => {
  const { orchestrator, plan } = fixture();
  await orchestrator.create({
    id: "session",
    userStoryId: "story",
    ownerUserId: "owner",
    profile: "vercel-compose",
    plan,
    planHash: "hash",
    cloudUploadConsentAt: new Date().toISOString(),
  });
  await assert.rejects(
    () =>
      orchestrator.command("session", { type: "start-agent" }, "start-agent"),
    (error) =>
      error instanceof PreviewRuntimeError &&
      error.failure.code === "UNSUPPORTED_CAPABILITY",
  );
  assert.notEqual((await orchestrator.get("session")).state.agent, "running");
});

test("exports before suspension and defers runner ack until resume", async () => {
  const { driver, orchestrator, plan } = fixture();
  await orchestrator.create({
    id: "session",
    userStoryId: "story",
    ownerUserId: "owner",
    profile: "vercel-compose",
    plan,
    planHash: "hash",
    cloudUploadConsentAt: new Date().toISOString(),
  });
  const suspended = await orchestrator.command(
    "session",
    { type: "suspend-host" },
    "suspend",
  );
  assert.equal(suspended.state.host, "suspended");
  assert.equal(suspended.state.sync, "pending_local_sync");
  await assert.rejects(
    () => orchestrator.command("session", { type: "destroy-host" }, "destroy"),
    (error) =>
      error instanceof PreviewRuntimeError &&
      error.failure.code === "SYNC_CONFLICT",
  );
  const pending = await orchestrator.get("session");
  const acknowledged = await orchestrator.command(
    "session",
    {
      type: "ack-local-sync",
      deltaRevision: pending.lastExportedJournalRevision!,
    },
    "ack",
  );
  assert.equal(acknowledged.state.sync, "clean");
  assert.equal(
    driver.calls.filter((call) => call === "acknowledgeDelta").length,
    0,
  );
  const resumed = await orchestrator.command(
    "session",
    { type: "resume-host" },
    "resume",
  );
  assert.equal(resumed.generation, suspended.generation + 1);
  assert.equal(
    resumed.lastAcknowledgedRemoteRevision,
    pending.lastExportedJournalRevision,
  );
  assert.equal(
    driver.calls.filter((call) => call === "acknowledgeDelta").length,
    1,
  );
  const destroyed = await orchestrator.command(
    "session",
    { type: "destroy-host" },
    "destroy-2",
  );
  assert.equal(destroyed.state.host, "destroyed");
});

test("acknowledges a durable delta after the retained sandbox was released", async () => {
  const { driver, orchestrator, plan, repository } = fixture();
  await orchestrator.create({
    id: "session",
    userStoryId: "story",
    ownerUserId: "owner",
    profile: "vercel-compose",
    plan,
    planHash: "hash",
    cloudUploadConsentAt: new Date().toISOString(),
  });
  const suspended = await orchestrator.command(
    "session",
    { type: "suspend-host" },
    "suspend",
  );
  await repository.setRuntimeHandle("session", undefined);

  const acknowledged = await orchestrator.command(
    "session",
    {
      type: "ack-local-sync",
      deltaRevision: suspended.lastExportedJournalRevision!,
    },
    "ack",
  );

  assert.equal(acknowledged.state.host, "suspended");
  assert.equal(acknowledged.state.sync, "clean");
  assert.equal(acknowledged.pendingDeltaArtifactId, undefined);
  assert.equal(
    acknowledged.lastAcknowledgedRemoteRevision,
    suspended.lastExportedJournalRevision,
  );
  assert.equal(
    driver.calls.filter((call) => call === "acknowledgeDelta").length,
    0,
  );

  const resumed = await orchestrator.command(
    "session",
    { type: "resume-host" },
    "resume",
  );
  assert.equal(resumed.state.host, "running");
  assert.equal(
    driver.calls.filter((call) => call === "provisionHost").length,
    2,
  );
});

test("still suspends compute when a durable delta export fails", async () => {
  const { driver, orchestrator, plan } = fixture();
  await orchestrator.create({
    id: "session",
    userStoryId: "story",
    ownerUserId: "owner",
    profile: "vercel-compose",
    plan,
    planHash: "hash",
    cloudUploadConsentAt: new Date().toISOString(),
  });
  driver.exportDeltaFailure = new Error("object storage unavailable");

  await assert.rejects(() =>
    orchestrator.command("session", { type: "suspend-host" }, "suspend"),
  );

  const failed = await orchestrator.get("session");
  assert.equal(failed.state.host, "suspended");
  assert.equal(failed.state.engine, "stopped");
  assert.equal(failed.state.sync, "failed");
  assert.equal(driver.calls.filter((call) => call === "suspendHost").length, 1);

  driver.exportDeltaFailure = undefined;
  const retried = await orchestrator.command(
    "session",
    { type: "suspend-host" },
    "suspend-retry",
  );
  assert.equal(retried.state.host, "suspended");
  assert.equal(retried.state.sync, "pending_local_sync");
  assert.equal(retried.generation, failed.generation + 1);
  assert.equal(driver.calls.filter((call) => call === "resumeHost").length, 1);
});

test("does not repeat a successful suspension or emit another operation", async () => {
  const { driver, orchestrator, plan, repository } = fixture();
  await orchestrator.create({
    id: "session",
    userStoryId: "story",
    ownerUserId: "owner",
    profile: "vercel-compose",
    plan,
    planHash: "hash",
    cloudUploadConsentAt: new Date().toISOString(),
  });
  const first = await orchestrator.command(
    "session",
    { type: "suspend-host" },
    "reap-1",
  );
  const calls = driver.calls.filter((call) => call === "suspendHost").length;
  const second = await orchestrator.command(
    "session",
    { type: "suspend-host" },
    "reap-2",
  );
  assert.equal(second.revision, first.revision);
  assert.equal(
    driver.calls.filter((call) => call === "suspendHost").length,
    calls,
  );
  assert.equal(await repository.getOperation("session", "reap-2"), undefined);
});

test("rejects an acknowledgement older than the latest durable delta", async () => {
  const { driver, orchestrator, plan, repository } = fixture();
  await orchestrator.create({
    id: "session",
    userStoryId: "story",
    ownerUserId: "owner",
    profile: "vercel-compose",
    plan,
    planHash: "hash",
    cloudUploadConsentAt: new Date().toISOString(),
  });
  const first = await orchestrator.command(
    "session",
    { type: "suspend-host" },
    "suspend-1",
  );
  const firstRevision = first.lastExportedJournalRevision!;
  await orchestrator.command(
    "session",
    { type: "ack-local-sync", deltaRevision: firstRevision },
    "ack-1",
  );
  await orchestrator.command("session", { type: "resume-host" }, "resume");
  driver.mutate((await repository.getRuntimeHandle("session"))!);
  const second = await orchestrator.command(
    "session",
    { type: "suspend-host" },
    "suspend-2",
  );
  assert.notEqual(second.lastExportedJournalRevision, firstRevision);
  await assert.rejects(
    () =>
      orchestrator.command(
        "session",
        { type: "ack-local-sync", deltaRevision: firstRevision },
        "stale-ack",
      ),
    (error) =>
      error instanceof PreviewRuntimeError &&
      error.failure.code === "SYNC_CONFLICT",
  );
  assert.equal(
    (await orchestrator.get("session")).pendingDeltaArtifactId,
    second.pendingDeltaArtifactId,
  );
});

test("sync conflicts stop compute and remain explicit", async () => {
  const { driver, orchestrator, plan } = fixture();
  await orchestrator.create({
    id: "session",
    userStoryId: "story",
    ownerUserId: "owner",
    profile: "vercel-compose",
    plan,
    planHash: "hash",
    cloudUploadConsentAt: new Date().toISOString(),
  });
  await orchestrator.command(
    "session",
    { type: "start-services", configurationId: "dev" },
    "start",
  );

  const conflicted = await orchestrator.command(
    "session",
    { type: "report-sync-conflict" },
    "conflict",
  );

  assert.equal(conflicted.state.host, "suspended");
  assert.equal(conflicted.state.engine, "stopped");
  assert.equal(conflicted.state.sync, "conflict");
  assert.equal(driver.calls.filter((call) => call === "suspendHost").length, 1);
});

test("does not report a preview ready when a selected service exited", async () => {
  const { driver, orchestrator, plan } = fixture();
  await orchestrator.create({
    id: "session",
    userStoryId: "story",
    ownerUserId: "owner",
    profile: "vercel-compose",
    plan,
    planHash: "hash",
    cloudUploadConsentAt: new Date().toISOString(),
  });
  driver.unavailableServiceIds.add("web");

  await assert.rejects(
    () =>
      orchestrator.command(
        "session",
        { type: "start-services", configurationId: "dev", serviceIds: ["web"] },
        "start",
      ),
    (error) =>
      error instanceof PreviewRuntimeError &&
      error.failure.code === "ENGINE_START_FAILED",
  );
  assert.equal((await orchestrator.get("session")).state.preview, "closed");
});
