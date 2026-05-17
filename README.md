# Blame

Blame is an agentic IDE built as a pnpm and Turborepo monorepo.

## Workspace

- `packages/api`: AdonisJS cloud backend imported from the previous OpenCode-based project.
- `packages/app`: React and Vite web app imported from the previous OpenCode-based project.

## Commands

```sh
pnpm install
pnpm dev
pnpm typecheck
pnpm build
```

## Agent Runtime Direction

The imported app still contains temporary OpenCode SDK references. The next migration step is to replace those references with a dedicated Cline integration package, such as `packages/agent-runtime` or `packages/cline-adapter`.

That package should own the `@cline/sdk` integration through `ClineCore` and expose stable application-level interfaces for sessions, messages, approvals, workspace actions, tools, and runtime events.
