# Blame

**Blame is an agentic IDE that turns AI coding into a controlled engineering workflow.**

Blame is built for developers who want to benefit from the speed of AI without losing control over their codebase.

It is not just another editor with an AI chat. Blame provides a structured development environment where AI agents work inside a clear workflow: backlog, user stories, code practices, automated worktrees, local previews, human validation, and controlled merges.

---

## Why Blame?

AI coding tools are fast, but they often remain centered around prompts and isolated chat conversations.

This creates several problems:

- requests are scattered across conversations;
- changes are hard to track;
- generated code does not always follow project standards;
- features are not always connected to a real backlog;
- test environments often need to be configured manually;
- Git worktrees are created, but rarely ready to use.

Even when an AI agent creates a worktree for a feature, the developer often still has to install dependencies, copy `.env` files, handle port conflicts, start the local server, find the right browser tab, and merge the work properly.

Blame aims to remove that friction.

---

## Product Vision

Blame is designed to become the agentic IDE where developers and teams can manage AI like a real engineering workflow.

The agent does not work in an isolated conversation. It works on a user story, inside a dedicated worktree, with project-specific rules, a testable local environment, visible diffs, and a final merge controlled by the user.

The goal is not only to make AI write code faster.

The goal is to make AI-generated work **traceable, reviewable, testable, and safe to integrate**.

---

## Core Concepts

Blame is a cross-platform desktop application for Linux, Windows, and macOS.

A developer opens a project like in a traditional IDE, then works through structured modes designed for AI-assisted development.

---

## Backlog

The backlog is the core of the workflow.

Developers can create user stories, tickets, or technical tasks. Each item can include:

- a clear objective;
- acceptance criteria;
- technical constraints;
- related files;
- implementation notes;
- status tracking.

Blame can help refine the user story, propose an implementation plan, and then execute the work progressively.

Instead of asking an AI to “just code something”, the developer gives it a structured task with clear boundaries.

---

## Quick Chat

For smaller tasks, Blame also provides a direct interaction mode.

Quick Chat can be used to:

- fix a bug;
- explain a file;
- generate a component;
- write a test;
- update a configuration;
- refactor a function.

This gives developers the choice between a structured backlog workflow and a faster chat-based interaction.

---

## Code Practices

Blame includes a dedicated **Code Practices** section to control the standards of each project.

Developers can enable or disable practices depending on the codebase, such as:

- clean code;
- SOLID principles;
- unit testing;
- layered architecture;
- naming conventions;
- UI / business logic separation;
- error handling;
- folder structure;
- Git rules.

Blame can detect when a practice is not currently present in the project and display:

> Practice not found in this codebase.

It can also suggest an action such as:

> Refactor the codebase to apply this practice.

The purpose is to ensure that AI does not only generate code, but generates code that is consistent with the project’s standards.

---

## Automated Git Worktrees

One of Blame’s main differentiators is native Git worktree automation.

When a user story is ready, the developer clicks **Start Development**.

Blame can then automatically:

- create or open a dedicated Git worktree;
- install dependencies if needed;
- synchronize environment files;
- assign an available local port;
- start the development server;
- expose a local preview inside the IDE;
- keep the feature, branch, worktree, and preview linked together.

Developers no longer need to manually handle:

- `git worktree add`;
- `pnpm install`, `npm install`, or equivalent commands;
- `.env` file copying;
- port conflicts;
- local development servers;
- mixed browser tabs;
- branch-to-feature tracking.

Each user story gets its own isolated, testable, clearly identified development environment.

Once the user story is validated, Blame provides a **Merge** action to integrate the work back into the main project.

---

## Local Preview

Blame links each active user story to its own local preview.

The developer can test the feature directly from the IDE without manually searching for the correct localhost URL or browser tab.

This makes it easier to review AI-generated work in context before accepting it.

---

## Human Validation

Blame keeps the developer in control.

Before merging, the user can review:

- generated changes;
- diffs;
- logs;
- test results;
- implementation notes;
- local preview behavior.

The developer can then approve, adjust, reject, or merge the work.

AI can move fast, but the final decision remains human-controlled.

---

## Assisted Project Creation

Blame can also include assisted project creation.

The developer selects a stack:

- frontend framework;
- backend framework;
- database;
- ORM;
- authentication;
- UI kit;
- Docker setup;
- CI/CD;
- testing;
- linting;
- monorepo or standalone architecture.

The AI knows how to initialize frameworks and generate a clean, professional project structure.

Creating a full-stack monorepo becomes a guided process instead of a fragile manual setup.

---

## Typical Workflow

1. Open a project.
2. Let Blame analyze the codebase, stack, commands, and conventions.
3. Create a user story or start a quick request.
4. Review the AI-generated development plan.
5. Click **Start Development**.
6. Blame prepares the worktree and local environment.
7. The agent implements the feature.
8. Test the result through the integrated localhost preview.
9. Review diffs, logs, and results.
10. Validate, request changes, or reject the work.
11. Merge the feature when ready.

---

## Differentiation

Most AI coding tools focus on chat, autocomplete, or CLI agents.

Blame focuses on turning AI coding into an actual engineering process.

It provides:

- an integrated backlog;
- executable user stories;
- configurable code practices;
- automated Git worktrees;
- local preview management;
- visible diffs;
- assisted merges;
- assisted project creation;
- traceability of AI work.

Blame is not only about generating code faster.

It is about making AI-generated code easier to control, review, test, and ship.

---

## Short Pitch

**Blame is an agentic IDE that transforms AI coding into a structured, controllable development workflow.**

Instead of working through scattered prompts, developers manage their project through a backlog, user stories, code practices, and isolated development environments.

Each user story can run in its own Git worktree, automatically configured with dependencies, environment files, ports, local server, integrated preview, and final merge flow.

Blame helps developers move faster with AI without sacrificing code quality, traceability, or control.

---

## Positioning

**Blame is the agentic IDE that turns AI coding into a controlled engineering workflow.**
