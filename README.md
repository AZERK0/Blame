# Blame

**Blame is the agentic IDE that turns AI coding into a controlled engineering workflow.**

Blame is a cross-platform desktop IDE designed for developers who want to benefit from the speed of AI without losing control over their codebase.

It is not just an editor with an AI chat. Blame provides a structured development environment where AI works inside a clear workflow: backlog, user stories, code practices, automated worktrees, local preview, human validation, diffs, and controlled merge.

**Blame turns AI-generated code into a manageable, traceable, and production-oriented development process.**

---

## Problem

Current AI coding tools accelerate development, but they are often centered around prompts, chats, or isolated agent sessions.

This creates several issues:

- requests are scattered across conversations;
- developers can easily lose track of changes;
- AI does not always follow project standards;
- features are not always connected to a real backlog;
- test environments often require manual setup;
- Git worktrees may be created, but are rarely ready to use.

In practice, even when an agent creates a worktree for a feature, the developer still has to install dependencies, copy `.env` files, resolve port conflicts, start the local server, find the correct browser tab, and merge the changes manually.

That can easily waste 10 to 15 minutes for every new feature before testing even begins.

---

## Vision

Blame aims to become the agentic IDE that lets developers and teams manage AI like a real development team.

The product gives the agent a clear framework:

- what to build;
- which context to use;
- which rules to follow;
- which environment to run in;
- how the result should be reviewed;
- when the work can be merged.

AI does not work in an isolated conversation. It works on a user story, inside a dedicated Git worktree, with a testable local server, defined code practices, reviewable diffs, and a merge validated by the user.

---

## Product Concept

Blame is a cross-platform desktop application compatible with Linux, Windows, and macOS.

The user opens a project like in a traditional IDE, then works inside a structured environment built around several development modes.

---

## Core Features

### Backlog

The backlog is the center of the Blame workflow.

Users can create user stories, tickets, or technical tasks. Each item can include:

- an objective;
- acceptance criteria;
- technical constraints;
- related files;
- implementation notes;
- a status.

The AI can help write the user story, propose a development plan, and implement the feature progressively in a traceable way.

---

### Quick Chat

For smaller tasks, Blame also provides a more direct interaction mode.

Quick Chat can be used to:

- fix a bug;
- explain a file;
- generate a component;
- write a test;
- update a configuration;
- refactor a function.

This lets the user choose between a structured backlog-based workflow and a faster direct interaction.

---

### Code Practices

Blame includes a **Code Practices** page to control project standards.

Users can enable or disable practices depending on the codebase, such as:

- clean code;
- SOLID principles;
- unit tests;
- layered architecture;
- naming conventions;
- UI / business logic separation;
- proper error handling;
- folder structure;
- Git rules.

Blame can also detect when a practice is not present in the codebase and display:

> Practice not present in the project codebase.

With a possible action:

> Refactor the codebase to apply this practice.

The goal is not only to make AI write code, but to make it write code that stays consistent with the project’s standards.

---

### Automated Git Worktrees

A major differentiator of Blame is its native Git worktree workflow.

When a user story is ready, the user clicks **Start Development**. Blame then automatically creates or opens a dedicated worktree, installs dependencies if needed, synchronizes environment files, assigns an available port, starts the local server, and exposes a preview button directly inside the IDE.

The developer no longer has to manually manage:

- `git worktree add`;
- `pnpm install` or equivalent commands;
- `.env` file copying;
- port conflicts;
- local servers;
- mixed browser tabs;
- the link between branch, feature, and localhost.

Each user story becomes an isolated, testable, and clearly identified development environment.

Once the user story is validated, Blame displays a **Merge** action to integrate the changes cleanly into the main project.

---

### Local Preview

Blame connects each active user story to its own local development environment.

The user can test the result directly from the IDE through a dedicated **Preview localhost** action.

This makes it easier to verify the AI output without manually tracking which server, branch, port, or browser tab belongs to which feature.

---

### Assisted Project Creation

Blame can also include an assisted project creation workflow.

The user chooses the desired stack:

- frontend framework;
- backend framework;
- database;
- ORM;
- authentication;
- UI kit;
- Docker setup;
- CI/CD;
- tests;
- linting;
- monorepo or single repository.

The AI knows the initialization commands of common frameworks and generates a clean, structured, ready-to-develop project.

Creating a full-stack monorepo becomes a guided process instead of a long and fragile manual setup.

---

## User Workflow

1. The user opens a project.
2. Blame analyzes the codebase, stack, commands, and conventions.
3. The user creates a user story or starts a quick request.
4. Blame proposes a development plan.
5. The user clicks **Start Development**.
6. Blame prepares the worktree and local environment.
7. The agent implements the feature.
8. The user tests it through **Preview localhost** inside the IDE.
9. Blame displays diffs, logs, and results.
10. The user validates, adjusts, or rejects the work.
11. If everything is correct, the user clicks **Merge**.

---

## Differentiation

Blame stands out from current AI IDEs through its structured workflow.

Where many tools mainly provide chat, autocomplete, or CLI agents, Blame provides:

- an integrated backlog;
- executable user stories;
- configurable code practices;
- automated Git worktrees;
- integrated localhost previews;
- clear diff control;
- assisted merge;
- guided project creation;
- full traceability of AI work.

Blame does not only aim to make AI code faster. It aims to make AI work usable, controllable, and reliable inside a real software engineering workflow.

---

## Workspace

Blame is built as a `pnpm` and Turborepo monorepo.

```txt
packages/
  api/              AdonisJS cloud backend with encrypted provider credentials
  app/              React and Vite web application
  desktop/          Electron shell with IPC bridge
  agent-runtime/    Cline SDK runtime wrapper
  harness-core/     Framework-independent harness contracts and authorities
  preview-contract/ Shared preview contracts
  preview-runtime/  Preview lifecycle and provider adapters
```

## Engineering Documentation

The documentation is maintained as four standalone English LaTeX documents:

- [Semantic harness study](docs/semantic-harness-study.tex): current architecture, edit and validation guarantees, historical benchmark evidence, limitations, and prioritized recommendations.
- [Architecture summary](docs/architecture-summary.tex): package boundaries, the current Light harness, and workspace execution.
- [Refactoring summary](docs/refactoring-summary.tex): extracted responsibilities, preserved behavior, validation, and follow-up work.
- [Open-source readiness](docs/open-source-readiness.tex): self-hosting dependencies and the remaining release decisions.

Each document can be compiled independently. Historical specifications and benchmark traces are available in Git history; current behavior is defined by the source code and tests.
