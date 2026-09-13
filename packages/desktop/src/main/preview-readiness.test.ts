import assert from "node:assert/strict";
import test from "node:test";
import {
  containerMatchesWorktree,
  previewComposeProjectName,
  previewContainerFailure,
} from "./preview-readiness.ts";

test("discovers nerdctl containers using the same project identity as compose", () => {
  const worktree =
    "/home/blame/.local/share/blame/runtime/worktrees/JuliettePortfolio/story-US-006-untitled-user-story";
  const container = {
    Config: {
      Labels: {
        "com.docker.compose.project": "blame_5bb04a7d0a8c",
        "com.docker.compose.service": "web",
      },
    },
  };
  assert.equal(previewComposeProjectName(worktree), "blame_5bb04a7d0a8c");
  assert.equal(containerMatchesWorktree(container, worktree), true);
  assert.equal(containerMatchesWorktree(container, `${worktree}-other`), false);
  assert.equal(containerMatchesWorktree({}, worktree), false);
  assert.equal(containerMatchesWorktree({}, ""), false);
});

test("keeps Docker path labels working without matching sibling worktrees", () => {
  const byDirectory = {
    Config: {
      Labels: {
        "com.docker.compose.project.working_dir": "C:\\work\\story\\",
      },
    },
  };
  const byConfig = {
    Config: {
      Labels: {
        "com.docker.compose.project.config_files":
          "/work/story/.blame/docker-compose.yml",
      },
    },
  };
  assert.equal(containerMatchesWorktree(byDirectory, "C:/work/story"), true);
  assert.equal(containerMatchesWorktree(byConfig, "/work/story/"), true);
  assert.equal(containerMatchesWorktree(byConfig, "/work/sto"), false);
});

test("allows container discovery during the startup grace period", () => {
  assert.equal(
    previewContainerFailure({
      discoveryGraceMs: 15_000,
      elapsedMs: 5_000,
      found: false,
    }),
    undefined,
  );
});

test("fails missing containers after the startup grace period", () => {
  assert.equal(
    previewContainerFailure({
      discoveryGraceMs: 15_000,
      elapsedMs: 15_000,
      found: false,
    }),
    "preview_container_missing",
  );
});

test("fails terminal and unhealthy container states", () => {
  assert.equal(
    previewContainerFailure({
      discoveryGraceMs: 15_000,
      elapsedMs: 1_000,
      found: true,
      health: "unhealthy",
      status: "running",
    }),
    "preview_container_stopped",
  );
});
