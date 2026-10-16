# Blame

**A desktop development environment for AI agents, from backlog to reviewed merge.**

Blame connects tasks, coding agents, isolated Git worktrees, previews, and code review in one workspace. Give an agent a user story, inspect its changes, test the result, and decide what gets merged.

[Download](https://blame.so/download) · [Website](https://blame.so) · [Features](#features) · [Development](#development) · [Documentation](#documentation) · [Contributing](#contributing)

[![CI](https://github.com/rchrp/Blame/actions/workflows/ci.yml/badge.svg)](https://github.com/rchrp/Blame/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)

[![Watch the Blame demo on YouTube](packages/vitrine/public/demo.gif)](https://youtu.be/cD6jASpIKQw)

**[Watch the demo on YouTube](https://youtu.be/cD6jASpIKQw)**

## Features

- **Backlog-driven development.** Turn user stories into agent tasks and follow them through the queue, development, review, and merge.
- **Isolated Git worktrees.** Keep each task's branch and working directory separate, with its own environment and preview lifecycle.
- **Quick Chat.** Work directly with an agent for smaller changes, debugging, and code exploration.
- **Project code practices.** Give agents project-level conventions and implementation guidance.
- **Integrated previews and review.** Inspect the running app, diffs, files, logs, and terminal output before approving a merge.
- **Your own AI providers.** Connect supported providers with your own credentials rather than tying the workflow to a single model.
- **Light Semantic Harness.** Use syntax-aware code navigation, guarded edits, and explicit execution and validation evidence. See the [harness study](docs/semantic-harness-study.tex) for implementation details and research limits.

## How it works

1. Open a Git repository or create a project.
2. Configure your AI provider and project code practices.
3. Write a user story and send it to an agent.
4. Review the implementation in its worktree and preview environment.
5. Request changes, reject the result, or approve and merge.

Local execution uses native worktrees on Linux, Lima on macOS, and WSL on Windows. Managed cloud previews synchronize a workspace snapshot to a Vercel Sandbox; they are separate from deploying to your own Vercel account.

## Get started

Download the desktop app for **macOS, Windows, or Linux** from [blame.so/download](https://blame.so/download).

Sign in, open a project, and connect a supported AI provider. Complete the runtime setup for your platform when prompted. The desktop app supplies filesystem, Git, terminal, and local runtime capabilities; the web frontend alone does not provide those capabilities.

### Free core and Premium services

| Available without a Blame subscription | Requires Blame Premium                                        |
| -------------------------------------- | ------------------------------------------------------------- |
| Projects, backlog, and conversations   | Cloud voice transcription                                     |
| Local worktrees and local previews     | Managed Vercel previews                                       |
| Your own AI provider credentials       | New hosted file uploads, including deployment source archives |

Blame Premium is **20 USD/month** or **200 USD/year**, billed once a year for the annual plan, with the existing transcription and cloud preview quotas. AI provider usage is subject to your provider's own pricing and limits. Authentication and data ownership checks apply to both plans.

Existing files remain accessible after a subscription expires. Cloud cleanup and source recovery also remain available. See [pricing](https://blame.so/pricing) for the hosted offer.

## Development

Blame is a TypeScript monorepo using [pnpm](https://pnpm.io) and [Turborepo](https://turbo.build).

### Prerequisites

- **Node.js 24**, matching CI. The root package declares Node.js 22 or later.
- **pnpm 10.33.2**, pinned in `package.json`.
- **Git** and a local **MySQL 8.4** database for the API.
- A graphical desktop session to run Electron. Local execution also needs the platform's container or VM runtime.

### Install dependencies

```bash
git clone https://github.com/rchrp/Blame.git
cd Blame
corepack enable
pnpm install --frozen-lockfile
```

If Corepack is unavailable in your Node.js installation, install the pinned pnpm version using the [pnpm installation guide](https://pnpm.io/installation).

### Configure the API

Create a local MySQL database and user, then copy the environment template:

```bash
cp packages/api/.env.example packages/api/.env
pnpm --filter @blame/api exec node ace.js generate:key
```

Edit `packages/api/.env` for your local services:

| Configuration  | Local development setup                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Database       | Set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_DATABASE` to your local MySQL instance.                                |
| Origins        | Keep the API on `http://localhost:3333` and allow `http://localhost:5173` in `BETTER_AUTH_TRUSTED_ORIGINS` and `CORS_ORIGIN`.      |
| Authentication | Set `BETTER_AUTH_SECRET` to a separate random secret of at least 32 characters.                                                    |
| Telemetry      | Set `BLAME_TELEMETRY_TOKEN_SECRET` to another random secret. Configure the public and upstream endpoints for your own environment. |
| File storage   | Use `ATTACHMENTS_STORAGE_DRIVER=memory` and `BLAME_WORKSPACE_STORAGE_DRIVER=memory` for disposable development storage.            |
| Cloud previews | Keep `BLAME_CLOUD_RUNTIME_ENABLED=false` unless you are configuring the managed infrastructure.                                    |
| Model catalog  | Set `BLAME_MODEL_CATALOG_LIVE_REFRESH=false` to use the bundled catalog without live refresh.                                      |

The memory storage drivers lose uploaded content when the API process stops. Durable deployments need configured object storage.

Email/password registration requires email verification. Configure `RESEND_API_KEY` and `AUTH_EMAIL_FROM` to complete that flow against your own backend. Social sign-in, billing, transcription, and managed previews each require their corresponding service credentials when enabled. The environment template lists these integrations.

Build the API's workspace dependencies and apply migrations:

```bash
pnpm exec turbo run build --filter='@blame/api^...'
pnpm --filter @blame/api exec node ace.js migration:run --no-schema-generate
```

### Run the application

Start the API:

```bash
pnpm --filter @blame/api dev
```

In another terminal, start the desktop app:

```bash
pnpm --filter @blame/desktop dev
```

For web UI development, run the frontend instead:

```bash
pnpm exec turbo run build --filter='@blame/app^...'
pnpm --filter @blame/app dev
```

The web frontend uses `http://localhost:3333/api/v1` in development. Set `VITE_CLOUD_API_URL` to override that origin when needed.

For local browser sign-in and email verification pages, also run the website:

```bash
cp packages/vitrine/.env.example packages/vitrine/.env.local
pnpm --filter @blame/vitrine dev
```

Set `NEXT_PUBLIC_BLAME_API_URL=http://localhost:3333/api/v1` in the website environment and `BLAME_SITE_URL=http://localhost:3000` in the API environment. Add `http://localhost:3000` to `CORS_ORIGIN` for browser requests.

Use these package commands for local development. The root `pnpm dev` command currently starts the maintainer's SSH database tunnel.

### Checks

Run the checks relevant to your change before opening a pull request:

```bash
pnpm lint
pnpm typecheck
pnpm --filter @blame/app test
pnpm --filter @blame/desktop test
pnpm --filter @blame/agent-runtime test
```

API tests use `packages/api/.env.test`. Configure a dedicated test database before running functional tests: their setup and teardown can migrate, truncate, or reset that database.

```bash
pnpm --filter @blame/api test
```

`pnpm build` and `pnpm test` run the monorepo-wide pipelines. Individual packages also expose focused suites. See the [CI workflow](.github/workflows/ci.yml) for the checks run in CI and the [desktop documentation](packages/desktop/README.md) for packaging and runtime images.

### Self-hosting status

The development setup is not yet a turnkey self-hosted distribution. Desktop backend origins, email, telemetry, durable storage, and managed-service configuration still need deployment-specific setup. The [open-source readiness summary](docs/open-source-readiness.tex) tracks these remaining dependencies and release decisions.

## Repository layout

| Path                                                                                                                                                   | Responsibility                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| [`packages/app`](packages/app)                                                                                                                         | React and Vite interface shared with the desktop app                                  |
| [`packages/desktop`](packages/desktop)                                                                                                                 | Electron host, preload bridge, Git, filesystem, and runtime integration               |
| [`packages/api`](packages/api)                                                                                                                         | AdonisJS API, authentication, persistence, encrypted credentials, and hosted services |
| [`packages/agent-runtime`](packages/agent-runtime)                                                                                                     | Cline SDK integration, agent sessions, and the Light Semantic Harness                 |
| [`packages/harness-core`](packages/harness-core)                                                                                                       | Framework-independent harness contracts and reference implementations                 |
| [`packages/preview-contract`](packages/preview-contract), [`packages/preview-runtime`](packages/preview-runtime)                                       | Shared preview contracts and lifecycle coordination                                   |
| [`packages/sandbox-runner`](packages/sandbox-runner), [`packages/preview-edge`](packages/preview-edge)                                                 | Managed sandbox execution and preview gateway                                         |
| [`packages/deploy-contract`](packages/deploy-contract), [`packages/model-catalog`](packages/model-catalog), [`packages/telemetry`](packages/telemetry) | Shared deployment, model, and observability support                                   |
| [`packages/vitrine`](packages/vitrine)                                                                                                                 | Public website and download pages                                                     |
| [`packages/benchmark-runner`](packages/benchmark-runner), [`tools/terminal_bench`](tools/terminal_bench)                                               | Agent evaluation tools and benchmark evidence                                         |

## Documentation

Engineering summaries are maintained as standalone English LaTeX sources:

- [Architecture](docs/architecture-summary.tex) — package boundaries, workspace execution, and the harness architecture.
- [Semantic harness study](docs/semantic-harness-study.tex) — measured results, implementation guarantees, limitations, and research directions.
- [Refactoring summary](docs/refactoring-summary.tex) — changes to module responsibilities and validation.
- [Open-source readiness](docs/open-source-readiness.tex) — licensing, self-hosting, and release preparation.
- [Releasing](RELEASING.md) — how the desktop app and its runtimes are built and published.

Each `.tex` document can be compiled independently. Benchmark results describe the versions and conditions under which they were measured; source code and tests define current behavior.

## Contributing

Bug reports, documentation improvements, and focused pull requests are welcome. For substantial features or architectural changes, open an [issue](https://github.com/rchrp/Blame/issues) to discuss the approach first.

- Include reproduction steps, platform information, and relevant logs in bug reports.
- Keep pull requests scoped; explain the problem, the change, and how you verified it.
- Follow the existing package boundaries. Renderer code uses the platform and preload interfaces; backend controllers delegate application logic to services.
- Read any `AGENTS.md` instructions that apply to the files you change.
- Use [Conventional Commits](https://www.conventionalcommits.org), for example `fix(preview): recover an interrupted session` or `docs: clarify local setup`.

For questions, use [GitHub issues](https://github.com/rchrp/Blame/issues). For security-sensitive reports, contact [support@blame.so](mailto:support@blame.so).

## License

Blame is licensed under the [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`).

Commercial use is permitted. When distributing covered software, you must provide its corresponding source under the same license. If you modify Blame and let users interact with it over a network, you must offer those users the corresponding source of your modified version, as required by section 13.

Third-party components retain their respective licenses and notices.
