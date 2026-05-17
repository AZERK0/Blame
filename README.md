# Blame

Blame is an agentic IDE built as a pnpm and Turborepo monorepo.

## Workspace

- `packages/api`: AdonisJS cloud backend with encrypted provider credentials.
- `packages/app`: React and Vite web app.
- `packages/desktop`: Electron shell with IPC bridge.
- `packages/agent-runtime`: Cline SDK runtime wrapper.

## Commands

```sh
pnpm install
pnpm dev
pnpm typecheck
pnpm build
```

## Agent Runtime

The Cline SDK integration lives in `packages/agent-runtime`. The desktop package exposes it to the renderer through Electron IPC, while the web app consumes a stable Blame platform interface.
