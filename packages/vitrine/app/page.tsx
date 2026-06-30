import Image from 'next/image'
import {
  ArrowRight,
  Boxes,
  ClipboardCheck,
  Code2,
  FileCode2,
  GitPullRequestArrow,
  Palette,
  Play,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { HeroScene } from './scene/hero-scene'

const navigationItems = ['Product', 'Pricing', 'Download']

const agentChaosCards = [
  {
    title: 'Parallel agents collide',
    description:
      'Running several agents at once is nearly impossible when they share the same branch, files, dependencies, and local server.',
  },
  {
    title: 'Worktrees don’t scale alone',
    description:
      'Git worktrees are the right foundation, but raw worktrees still need dependencies installed, env files copied, ports assigned, servers launched, and previews linked to the right task.',
  },
  {
    title: 'Context gets lost in chats',
    description:
      'Most AI coding starts from scattered prompts instead of structured user stories, acceptance criteria, project context, and a visible backlog.',
  },
  {
    title: 'AI slop gets merged',
    description:
      'Without project-specific coding practices, agents generate code that may work once, but ignores architecture, tests, naming, error handling, and long-term maintainability.',
  },
]

const parallelWorkflowSteps = [
  'User Story',
  'Prepared Worktree',
  'Live Preview',
  'Diff Review',
  'Controlled Merge',
]

const parallelAgentCards = [
  {
    title: 'Isolated by default',
    description:
      'Every agent works on its own task, branch, worktree, and context — keeping your main workspace clean.',
  },
  {
    title: 'Ready to run',
    description:
      'Blame prepares dependencies, env files, ports, commands, servers, and preview links for each task.',
  },
  {
    title: 'Controlled until merge',
    description:
      'Review the running result, inspect the diff, ask for changes, and merge only when the work is accepted.',
  },
]

const cloudWorkspaceCards = [
  {
    label: 'sync/backlog',
    title: 'Backlog synced',
    description:
      'Recover your tasks, user stories, acceptance criteria, and workflow state across devices.',
  },
  {
    label: 'project/standards',
    title: 'Standards remembered',
    description:
      'Keep your coding practices, architecture rules, testing preferences, and agent instructions attached to the project.',
  },
  {
    label: 'providers/ready',
    title: 'Providers ready',
    description:
      'Reconnect to your AI providers without rebuilding your setup every time you switch machines.',
  },
  {
    label: 'local/execution',
    title: 'Local execution',
    description:
      'Agents work inside local worktrees, with local previews and diffs. The cloud syncs the control plane.',
  },
]

const codePracticeCards = [
  {
    title: 'Code like the project',
    description:
      'Match existing conventions or apply a professional standard when the codebase has none.',
    badge: 'Match codebase',
  },
  {
    title: 'Test the behavior',
    description:
      'Use TDD and structured test cases for behavior, state, validation, data flows, boundaries, and failures.',
    badge: 'Pro standard',
  },
  {
    title: 'Respect the architecture',
    description:
      'Guide agents toward layered, Clean, Onion, or Hexagonal structures with clear dependencies.',
    badge: 'Architecture rules',
  },
  {
    title: 'Commit cleanly',
    description:
      'Keep generated work compatible with Conventional Commits and readable project history.',
    badge: 'Detected',
  },
]

const practiceDetectionRows = [
  {
    label: 'Coding style',
    status: 'Not detected',
    mode: 'Pro standard',
  },
  {
    label: 'Unit tests',
    status: 'Not detected',
    mode: 'Disabled / Pro standard',
  },
  {
    label: 'Layered architecture',
    status: 'Not detected',
    mode: 'Match codebase / Pro standard',
  },
  {
    label: 'Commit convention',
    status: 'Detected',
    mode: 'Match codebase',
  },
]

const specialistAgentCards = [
  {
    title: 'Codebase Analyst',
    description:
      'Maps the repository structure, stack, conventions, dependencies, and affected files.',
    icon: Search,
    accent: 'text-[#b3acf3]',
    glow: 'bg-[#b3acf3]/12',
  },
  {
    title: 'Story Analyst',
    description:
      'Turns vague requests into clear goals, acceptance criteria, non-goals, constraints, and edge cases.',
    icon: ClipboardCheck,
    accent: 'text-[#8fd8ff]',
    glow: 'bg-[#8fd8ff]/10',
  },
  {
    title: 'Frontend Specialist',
    description:
      'Reviews layout, hierarchy, responsiveness, accessibility, design consistency, and product-grade UI polish.',
    icon: Palette,
    accent: 'text-[#f0c987]',
    glow: 'bg-[#f0c987]/10',
  },
  {
    title: 'Test & Verification Analyst',
    description:
      'Defines what should be tested, which commands should run, and which behaviors need proof.',
    icon: Code2,
    accent: 'text-[#7dd3a8]',
    glow: 'bg-[#7dd3a8]/10',
  },
  {
    title: 'Risk Review Analyst',
    description:
      'Looks for regressions, unsafe assumptions, security issues, data risks, and merge blockers.',
    icon: ShieldCheck,
    accent: 'text-[#ffa5b8]',
    glow: 'bg-[#ffa5b8]/10',
  },
]

const projectCreationCards = [
  {
    title: 'Stack choices',
    description:
      'Frontend, backend, database, UI library, ORM, package manager, and project type.',
    badge: 'Web · Desktop · Mobile · Script',
  },
  {
    title: 'Clean baseline',
    description:
      'A structured project setup with scripts, env templates, linting, tests, and conventions.',
    badge: 'Scripts · Tests · Linting',
  },
  {
    title: 'Practices included',
    description:
      'Coding style, architecture rules, testing strategy, and commit conventions from the beginning.',
    badge: 'Rules from day one',
  },
  {
    title: 'Built for the workflow',
    description:
      'User stories, worktrees, previews, diffs, reviews, and controlled merges are ready from day one.',
    badge: 'Agent-ready',
  },
]

const foundationManifestRows = [
  ['stack', 'React · Adonis · PostgreSQL · Prisma'],
  ['package manager', 'pnpm workspace'],
  ['quality gates', 'typecheck · lint · test'],
  ['practices', 'style · architecture · commits'],
  ['agent workflow', 'stories · previews · diffs · reviews'],
]

export default function Home() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[#050712] text-white">
      <section
        id="top"
        aria-labelledby="hero-title"
        className="hero-stage relative isolate min-h-screen overflow-hidden"
      >
        <HeroScene />
        <SceneWarmup />
        <div className="pointer-events-none absolute -inset-8 -z-10 backdrop-blur-[12px] [mask-image:radial-gradient(ellipse_at_center,transparent_0%,transparent_48%,black_78%)]" />
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(2,4,10,0.12)_0%,rgba(2,4,10,0.24)_42%,rgba(2,4,10,0.52)_72%,rgba(2,4,10,0.86)_100%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-56 bg-gradient-to-b from-[#050712]/64 to-transparent" />

        <SiteHeader />

        <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-9xl flex-col px-5 pb-0 pt-24 sm:px-8 lg:px-10">
          <div className="flex flex-1 items-center justify-center pb-4 pt-8 sm:pb-6 lg:pb-8">
            <div className="text-center">
              <div className="landing-reveal landing-reveal-eyebrow mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-white/14 bg-white/[0.07] px-3 py-1.5 text-xs font-medium uppercase tracking-[0.32em] text-white/76 shadow-2xl shadow-black/30 backdrop-blur-md">
                <span className="h-1.5 w-1.5 rounded-full bg-[#b3acf3] shadow-[0_0_18px_rgba(179,172,243,0.9)]" />
                Agentic IDE
              </div>
              <h1
                id="hero-title"
                className="landing-reveal landing-reveal-title text-balance text-[clamp(3.4rem,10vw,9.5rem)] font-semibold leading-[0.9] tracking-[-0.095em] text-white drop-shadow-[0_20px_70px_rgba(0,0,0,0.55)]"
              >
                The industrial-grade
                <br />
                agentic IDE.
              </h1>
              <p className="landing-reveal landing-reveal-copy mx-auto mt-7 max-w-2xl text-balance text-base leading-7 text-white/76 sm:text-lg md:text-xl">
                Turn every request into an isolated worktree, with live preview,
                diffs, and controlled merge.
              </p>
              <div className="landing-reveal landing-reveal-actions mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <a
                  href="#waitlist"
                  className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold tracking-[-0.01em] text-[#080b16] shadow-[0_18px_60px_rgba(255,255,255,0.22)] transition duration-200 hover:-translate-y-0.5 hover:bg-[#bdc3fd] focus:outline-none focus:ring-2 focus:ring-[#b3acf3] focus:ring-offset-2 focus:ring-offset-[#050712]"
                >
                  Request access
                  <ArrowRight className="h-4 w-4 transition duration-200 group-hover:translate-x-0.5" />
                </a>
                <a
                  href="#workflow"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/14 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-white/90 backdrop-blur-md transition duration-200 hover:-translate-y-0.5 hover:bg-white/[0.1] focus:outline-none focus:ring-2 focus:ring-white/45 focus:ring-offset-2 focus:ring-offset-[#050712]"
                >
                  <Play className="h-4 w-4 fill-current" />
                  See the workflow
                </a>
              </div>
            </div>
          </div>

          <ProductMockup />
        </div>
        <style>{`
          .hero-stage canvas {
            opacity: 0;
            transform: scale(1.015);
            animation: sceneCanvasReveal 920ms cubic-bezier(0.2, 0.8, 0.2, 1) 160ms forwards;
          }

          .landing-reveal {
            opacity: 0;
            transform: translate3d(0, 18px, 0);
            animation: landingReveal 760ms cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
          }

          .landing-reveal-header {
            animation-delay: 80ms;
          }

          .landing-reveal-eyebrow {
            animation-delay: 150ms;
          }

          .landing-reveal-title {
            animation-delay: 220ms;
          }

          .landing-reveal-copy {
            animation-delay: 330ms;
          }

          .landing-reveal-actions {
            animation-delay: 430ms;
          }

          .landing-reveal-mockup {
            animation-delay: 540ms;
            transform: translate3d(0, 24px, 0) scale(0.985);
          }

          .scene-warmup {
            animation: sceneWarmupExit 560ms cubic-bezier(0.3, 0, 0, 1) 820ms forwards;
          }

          .scene-warmup-scan {
            animation: warmupScan 940ms cubic-bezier(0.7, 0, 0.2, 1) 120ms forwards;
          }

          @keyframes sceneCanvasReveal {
            to {
              opacity: 1;
              transform: scale(1);
            }
          }

          @keyframes landingReveal {
            to {
              opacity: 1;
              transform: translate3d(0, 0, 0) scale(1);
            }
          }

          @keyframes sceneWarmupExit {
            to {
              opacity: 0;
              transform: scale(1.015);
              visibility: hidden;
            }
          }

          @keyframes warmupScan {
            from {
              transform: translateX(-115%);
            }
            to {
              transform: translateX(115%);
            }
          }
        `}</style>
      </section>

      <section
        id="product"
        aria-labelledby="agent-chaos-title"
        className="relative isolate overflow-hidden px-5 py-24 sm:px-8 sm:py-32 lg:px-10"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent" />
        <div className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[38rem] w-[38rem] -translate-x-1/2 rounded-full bg-[#b3acf3]/10 blur-3xl" />
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto max-w-4xl text-center">
            <p className="mb-5 text-xs font-semibold uppercase tracking-[0.36em] text-[#b3acf3]">
              THE AGENT CHAOS
            </p>
            <h2
              id="agent-chaos-title"
              className="text-balance text-[clamp(2.5rem,6vw,5.5rem)] font-semibold leading-[0.92] tracking-[-0.075em] text-white"
            >
              AI coding is fast.
              <br />
              Shipping it safely is the hard part.
            </h2>
            <p className="mx-auto mt-7 max-w-3xl text-balance text-base leading-7 text-white/68 sm:text-lg md:text-xl">
              The problem is no longer generating code. The problem is keeping
              agent work isolated, testable, reviewable, and aligned with your
              engineering standards.
            </p>
          </div>

          <div className="mt-16 grid gap-4 md:grid-cols-2 lg:mt-20">
            {agentChaosCards.map((card, index) => (
              <article
                key={card.title}
                className="group relative overflow-hidden rounded-3xl border border-white/12 bg-white/[0.055] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl transition duration-200 hover:-translate-y-1 hover:border-[#b3acf3]/36 hover:bg-white/[0.075] sm:p-7"
              >
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(179,172,243,0.16),transparent_32%)] opacity-0 transition duration-200 group-hover:opacity-100" />
                <div className="relative">
                  <div className="mb-8 flex items-center justify-between gap-4">
                    <span className="text-xs font-semibold uppercase tracking-[0.28em] text-white/36">
                      0{index + 1}
                    </span>
                    <span className="h-px flex-1 bg-gradient-to-r from-white/14 to-transparent" />
                  </div>
                  <h3 className="text-2xl font-semibold tracking-[-0.035em] text-white sm:text-3xl">
                    {card.title}
                  </h3>
                  <p className="mt-4 text-base leading-7 text-white/64">
                    {card.description}
                  </p>
                </div>
              </article>
            ))}
          </div>

          <p className="mx-auto mt-14 max-w-3xl text-center text-xl font-semibold leading-8 tracking-[-0.03em] text-white sm:text-2xl">
            Blame turns agent output into isolated, previewable, reviewable
            engineering work.
          </p>
        </div>
      </section>

      <section
        id="workflow"
        aria-labelledby="parallel-agent-title"
        className="relative isolate overflow-hidden px-5 py-24 sm:px-8 sm:py-32 lg:px-10"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-white/14 to-transparent" />
        <div className="pointer-events-none absolute bottom-0 left-1/2 -z-10 h-[30rem] w-[44rem] -translate-x-1/2 rounded-full bg-[#b3acf3]/8 blur-3xl" />
        <div className="mx-auto max-w-[1100px]">
          <div className="mx-auto max-w-4xl text-center">
            <p className="mb-5 text-xs font-semibold uppercase tracking-[0.36em] text-[#b3acf3]">
              PARALLEL AGENT WORK
            </p>
            <h2
              id="parallel-agent-title"
              className="text-balance text-[clamp(2.35rem,5vw,4.8rem)] font-semibold leading-[0.95] tracking-[-0.07em] text-white"
            >
              Run multiple agents in parallel.
              <br />
              Without breaking your workflow.
            </h2>
            <p className="mx-auto mt-7 max-w-[720px] text-balance text-base leading-7 text-white/68 sm:text-lg md:text-xl">
              Launch several agents at once, each isolated in its own
              ready-to-run workspace with preview, diffs, and merge control
              built in.
            </p>
          </div>

          <div
            aria-label="Parallel agent workflow"
            className="mx-auto mt-10 flex max-w-5xl flex-wrap items-center justify-center gap-2 sm:mt-12"
          >
            {parallelWorkflowSteps.map((step, index) => (
              <div key={step} className="flex items-center gap-2">
                <span className="rounded-full border border-white/12 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-white/78 shadow-2xl shadow-black/20 backdrop-blur-xl sm:px-4 sm:text-sm">
                  {step}
                </span>
                {index < parallelWorkflowSteps.length - 1 ? (
                  <ArrowRight
                    aria-hidden="true"
                    className="h-4 w-4 text-[#b3acf3]/64"
                  />
                ) : null}
              </div>
            ))}
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-3 lg:mt-14">
            {parallelAgentCards.map((card, index) => (
              <article
                key={card.title}
                className="group relative overflow-hidden rounded-3xl border border-white/12 bg-white/[0.052] p-6 shadow-[0_22px_70px_rgba(0,0,0,0.24)] backdrop-blur-xl transition duration-200 hover:-translate-y-1 hover:border-[#b3acf3]/34 hover:bg-white/[0.074]"
              >
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(179,172,243,0.14),transparent_38%)] opacity-0 transition duration-200 group-hover:opacity-100" />
                <div className="relative">
                  <div className="mb-7 flex items-center gap-3">
                    <span className="grid h-8 w-8 place-items-center rounded-full border border-white/12 bg-white/[0.07] text-xs font-semibold text-[#d7d2ff]">
                      0{index + 1}
                    </span>
                    <span className="h-px flex-1 bg-gradient-to-r from-white/16 to-transparent" />
                  </div>
                  <h3 className="text-2xl font-semibold tracking-[-0.035em] text-white">
                    {card.title}
                  </h3>
                  <p className="mt-4 text-sm leading-6 text-white/64 sm:text-base sm:leading-7">
                    {card.description}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="cloud-workspace"
        aria-labelledby="cloud-workspace-title"
        className="relative isolate overflow-hidden px-5 py-24 sm:px-8 sm:py-32 lg:px-10"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-white/14 to-transparent" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[32rem] w-[48rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#b3acf3]/7 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-1/2 -z-10 h-px w-full max-w-5xl -translate-x-1/2 bg-gradient-to-r from-transparent via-[#b3acf3]/22 to-transparent" />

        <div className="mx-auto max-w-[1100px]">
          <div className="mx-auto max-w-4xl text-center">
            <p className="mb-5 text-xs font-semibold uppercase tracking-[0.36em] text-[#b3acf3]">
              CLOUD WORKSPACE
            </p>
            <h2
              id="cloud-workspace-title"
              className="text-balance text-[clamp(2.35rem,5vw,4.8rem)] font-semibold leading-[0.95] tracking-[-0.07em] text-white"
            >
              Pick up where you left off.
              <br />
              On any machine.
            </h2>
            <p className="mx-auto mt-7 max-w-[720px] text-balance text-base leading-7 text-white/68 sm:text-lg md:text-xl">
              Your backlog, user stories, provider connections, code practices,
              and project workflow stay synced — while code execution,
              worktrees, previews, and diffs stay local.
            </p>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:mt-14">
            {cloudWorkspaceCards.map((card) => (
              <article
                key={card.title}
                className="group relative overflow-hidden rounded-3xl border border-white/12 bg-white/[0.045] p-6 shadow-[0_22px_70px_rgba(0,0,0,0.22)] backdrop-blur-xl transition duration-200 hover:-translate-y-0.5 hover:border-[#b3acf3]/34 hover:bg-white/[0.065] sm:p-7"
              >
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(179,172,243,0.12),transparent_36%)] opacity-0 transition duration-200 group-hover:opacity-100" />
                <div className="relative">
                  <div className="mb-7 flex items-center gap-3">
                    <span className="rounded-full border border-white/12 bg-[#080b16]/70 px-3 py-1.5 font-mono text-[0.68rem] font-medium uppercase tracking-[0.16em] text-[#d7d2ff]/82">
                      {card.label}
                    </span>
                    <span className="h-px flex-1 bg-gradient-to-r from-white/16 to-transparent" />
                  </div>
                  <h3 className="text-2xl font-semibold tracking-[-0.035em] text-white sm:text-3xl">
                    {card.title}
                  </h3>
                  <p className="mt-4 text-sm leading-6 text-white/64 sm:text-base sm:leading-7">
                    {card.description}
                  </p>
                </div>
              </article>
            ))}
          </div>

          <div className="mt-12 flex justify-center">
            <p className="rounded-full border border-[#b3acf3]/22 bg-[#b3acf3]/10 px-4 py-2 text-center text-sm font-semibold tracking-[-0.01em] text-[#e7e4ff] shadow-[0_0_44px_rgba(179,172,243,0.14)] backdrop-blur-xl sm:text-base">
              Cloud control plane. Local engineering execution.
            </p>
          </div>
        </div>
      </section>

      <section
        id="code-practices"
        aria-labelledby="code-practices-title"
        className="relative isolate overflow-hidden px-5 py-24 sm:px-8 sm:py-32 lg:px-10"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-white/14 to-transparent" />
        <div className="pointer-events-none absolute left-1/2 top-20 -z-10 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-[#b3acf3]/9 blur-3xl" />
        <div className="pointer-events-none absolute bottom-16 right-[-12rem] -z-10 h-[28rem] w-[28rem] rounded-full bg-[#7dd3a8]/6 blur-3xl" />

        <div className="mx-auto max-w-[1100px]">
          <div className="mx-auto max-w-4xl text-center">
            <p className="mb-5 text-xs font-semibold uppercase tracking-[0.36em] text-[#b3acf3]">
              CODE PRACTICES
            </p>
            <h2
              id="code-practices-title"
              className="text-balance text-[clamp(2.35rem,5vw,4.8rem)] font-semibold leading-[0.95] tracking-[-0.07em] text-white"
            >
              AI agents should not improvise your architecture.
            </h2>
            <p className="mx-auto mt-7 max-w-[760px] text-balance text-base leading-7 text-white/68 sm:text-lg md:text-xl">
              Blame gives agents persistent engineering rules for coding style,
              tests, architecture, and commits — so every task follows the
              standards of your project instead of producing disposable AI slop.
            </p>
          </div>

          <div className="mt-14 grid gap-4 md:grid-cols-2 lg:mt-16">
            {codePracticeCards.map((card) => (
              <article
                key={card.title}
                className="group relative overflow-hidden rounded-3xl border border-white/12 bg-white/[0.05] p-6 shadow-[0_22px_70px_rgba(0,0,0,0.24)] backdrop-blur-xl transition duration-200 hover:-translate-y-1 hover:border-[#b3acf3]/34 hover:bg-white/[0.072] sm:p-7"
              >
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_0%,rgba(179,172,243,0.15),transparent_36%)] opacity-0 transition duration-200 group-hover:opacity-100" />
                <div className="relative">
                  <div className="mb-7 flex items-center justify-between gap-4">
                    <span className="rounded-full border border-[#b3acf3]/18 bg-[#b3acf3]/10 px-3 py-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[#d7d2ff]">
                      {card.badge}
                    </span>
                    <span className="h-px flex-1 bg-gradient-to-r from-white/16 to-transparent" />
                  </div>
                  <h3 className="text-2xl font-semibold tracking-[-0.035em] text-white sm:text-3xl">
                    {card.title}
                  </h3>
                  <p className="mt-4 text-sm leading-6 text-white/64 sm:text-base sm:leading-7">
                    {card.description}
                  </p>
                </div>
              </article>
            ))}
          </div>

          <div className="mt-6 overflow-hidden rounded-3xl border border-white/12 bg-[#080b16]/72 shadow-[0_24px_80px_rgba(0,0,0,0.32)] backdrop-blur-xl sm:mt-8">
            <div className="flex flex-col gap-3 border-b border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#b3acf3]">
                  Practice detection
                </p>
                <p className="mt-2 text-sm leading-6 text-white/58">
                  Blame checks what your repository already says before agents
                  start writing.
                </p>
              </div>
              <span className="inline-flex w-fit items-center rounded-full border border-[#7dd3a8]/18 bg-[#7dd3a8]/10 px-3 py-1.5 text-xs font-semibold text-[#bceccc]">
                Repository-aware rules
              </span>
            </div>

            <div className="divide-y divide-white/8">
              {practiceDetectionRows.map((row) => {
                const isDetected = row.status === 'Detected'

                return (
                  <div
                    key={row.label}
                    className="grid gap-3 px-5 py-4 text-sm sm:grid-cols-[1.1fr_0.7fr_1fr] sm:items-center sm:px-6"
                  >
                    <span className="font-medium text-white/86">{row.label}</span>
                    <span
                      className={`inline-flex w-fit items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                        isDetected
                          ? 'border-[#7dd3a8]/20 bg-[#7dd3a8]/10 text-[#bceccc]'
                          : 'border-white/12 bg-white/[0.055] text-white/54'
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          isDetected
                            ? 'bg-[#7dd3a8] shadow-[0_0_14px_rgba(125,211,168,0.65)]'
                            : 'bg-white/36'
                        }`}
                      />
                      {row.status}
                    </span>
                    <span className="font-mono text-xs uppercase tracking-[0.14em] text-white/44 sm:text-right">
                      {row.mode}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          <p className="mx-auto mt-12 max-w-3xl text-center text-xl font-semibold leading-8 tracking-[-0.03em] text-white sm:text-2xl">
            No more one-shot code. Every agent works inside your engineering
            standards.
          </p>
        </div>
      </section>

      <section
        id="specialist-agents"
        aria-labelledby="specialist-agents-title"
        className="relative isolate overflow-hidden px-5 py-24 sm:px-8 sm:py-32 lg:px-10"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-white/14 to-transparent" />
        <div className="pointer-events-none absolute left-1/2 top-10 -z-10 h-[34rem] w-[42rem] -translate-x-1/2 rounded-full bg-[#b3acf3]/8 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-[-12rem] -z-10 h-[26rem] w-[26rem] rounded-full bg-[#7dd3a8]/5 blur-3xl" />

        <div className="mx-auto max-w-[1100px]">
          <div className="mx-auto max-w-4xl text-center">
            <p className="mb-5 text-xs font-semibold uppercase tracking-[0.36em] text-[#b3acf3]">
              SPECIALIST AGENTS
            </p>
            <h2
              id="specialist-agents-title"
              className="text-balance text-[clamp(2.35rem,5vw,4.8rem)] font-semibold leading-[0.95] tracking-[-0.07em] text-white"
            >
              One main agent.
              <br />
              Five focused reviewers.
            </h2>
            <p className="mx-auto mt-7 max-w-[760px] text-balance text-base leading-7 text-white/68 sm:text-lg md:text-xl">
              The main agent implements the task. Specialist agents help it
              understand the repository, clarify intent, improve UI quality,
              plan verification, and catch risks before merge.
            </p>
          </div>

          <div className="mt-14 overflow-hidden rounded-[2rem] border border-white/12 bg-[#080b16]/70 shadow-[0_28px_90px_rgba(0,0,0,0.32)] backdrop-blur-xl lg:mt-16">
            <div className="grid gap-px bg-white/8 lg:grid-cols-[0.92fr_1.35fr]">
              <div className="relative overflow-hidden bg-[#080b16]/92 p-6 sm:p-8">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_8%,rgba(179,172,243,0.16),transparent_38%)]" />
                <div className="relative flex h-full flex-col justify-between gap-10">
                  <div>
                    <div className="mb-7 flex items-center gap-3">
                      <span className="grid h-10 w-10 place-items-center rounded-2xl border border-[#b3acf3]/24 bg-[#b3acf3]/12 text-[#d7d2ff] shadow-[0_0_30px_rgba(179,172,243,0.16)]">
                        <Sparkles className="h-5 w-5" />
                      </span>
                      <span className="rounded-full border border-white/12 bg-white/[0.06] px-3 py-1.5 font-mono text-[0.68rem] font-medium uppercase tracking-[0.16em] text-white/54">
                        Main coding agent
                      </span>
                    </div>
                    <h3 className="text-3xl font-semibold tracking-[-0.045em] text-white sm:text-4xl">
                      Implements the task.
                    </h3>
                    <p className="mt-5 text-sm leading-6 text-white/64 sm:text-base sm:leading-7">
                      Edits the code, integrates specialist feedback, prepares
                      the diff, and keeps the work attached to its user story.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-[#b3acf3]/18 bg-[#b3acf3]/10 p-4">
                    <div className="flex items-center gap-3 text-sm font-semibold text-[#e7e4ff]">
                      <GitPullRequestArrow className="h-4 w-4" />
                      One controlled implementation path
                    </div>
                    <p className="mt-2 text-xs leading-5 text-white/54">
                      Not five agents coding in five directions — one agent
                      builds while focused reviewers sharpen the result.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white/[0.025] p-4 sm:p-5 lg:p-6">
                <div className="mb-4 flex flex-col gap-2 px-1 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#b3acf3]">
                      Supported by reviewers
                    </p>
                    <p className="mt-2 text-sm leading-6 text-white/54">
                      Each specialist advises from one quality angle.
                    </p>
                  </div>
                  <span className="font-mono text-xs uppercase tracking-[0.14em] text-white/36">
                    advisory layer
                  </span>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  {specialistAgentCards.map((agent, index) => {
                    const Icon = agent.icon

                    return (
                      <article
                        key={agent.title}
                        className="group relative overflow-hidden rounded-2xl border border-white/10 bg-[#080b16]/82 p-4 transition duration-200 hover:-translate-y-0.5 hover:border-white/18 hover:bg-[#0d1020]/88"
                      >
                        <div
                          className={`pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full ${agent.glow} blur-2xl transition duration-200 group-hover:opacity-80`}
                        />
                        <div className="relative">
                          <div className="mb-4 flex items-center justify-between gap-3">
                            <span
                              className={`grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.055] ${agent.accent}`}
                            >
                              <Icon className="h-4 w-4" />
                            </span>
                            <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-white/32">
                              0{index + 1}
                            </span>
                          </div>
                          <h3 className="text-lg font-semibold tracking-[-0.025em] text-white">
                            {agent.title}
                          </h3>
                          <p className="mt-3 text-sm leading-6 text-white/58">
                            {agent.description}
                          </p>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="border-t border-white/10 bg-[#050712]/64 px-5 py-5 sm:px-8">
              <p className="text-center text-lg font-semibold leading-7 tracking-[-0.025em] text-white sm:text-xl">
                Specialists advise. The main agent integrates. The developer
                decides.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section
        id="project-creation"
        aria-labelledby="project-creation-title"
        className="relative isolate overflow-hidden px-5 py-24 sm:px-8 sm:py-32 lg:px-10"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-white/14 to-transparent" />
        <div className="pointer-events-none absolute left-1/2 top-16 -z-10 h-[30rem] w-[42rem] -translate-x-1/2 rounded-full bg-[#b3acf3]/7 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 right-[-10rem] -z-10 h-[24rem] w-[24rem] rounded-full bg-[#7dd3a8]/5 blur-3xl" />

        <div className="mx-auto max-w-[1100px]">
          <div className="mx-auto max-w-4xl text-center">
            <p className="mb-5 text-xs font-semibold uppercase tracking-[0.36em] text-[#b3acf3]">
              PROJECT CREATION
            </p>
            <h2
              id="project-creation-title"
              className="text-balance text-[clamp(2.35rem,5vw,4.8rem)] font-semibold leading-[0.95] tracking-[-0.07em] text-white"
            >
              From empty folder to agent-ready codebase.
            </h2>
            <p className="mx-auto mt-7 max-w-[760px] text-balance text-base leading-7 text-white/68 sm:text-lg md:text-xl">
              Pick a stack. Blame generates a clean foundation with scripts,
              dependencies, environment templates, code practices, and
              development commands already prepared for AI-assisted work.
            </p>
          </div>

          <div className="mt-14 grid gap-4 lg:grid-cols-[1fr_0.9fr] lg:items-stretch lg:mt-16">
            <div className="grid gap-4 md:grid-cols-2">
              {projectCreationCards.map((card, index) => (
                <article
                  key={card.title}
                  className="group relative overflow-hidden rounded-3xl border border-white/12 bg-white/[0.045] p-6 shadow-[0_22px_70px_rgba(0,0,0,0.2)] backdrop-blur-xl transition duration-200 hover:-translate-y-0.5 hover:border-[#b3acf3]/30 hover:bg-white/[0.064] sm:p-7"
                >
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(179,172,243,0.12),transparent_38%)] opacity-0 transition duration-200 group-hover:opacity-100" />
                  <div className="relative">
                    <div className="mb-7 flex items-center gap-3">
                      <span className="grid h-8 w-8 place-items-center rounded-full border border-white/12 bg-[#080b16]/72 font-mono text-[0.68rem] font-semibold text-[#d7d2ff]">
                        0{index + 1}
                      </span>
                      <span className="h-px flex-1 bg-gradient-to-r from-white/16 to-transparent" />
                    </div>
                    <h3 className="text-2xl font-semibold tracking-[-0.035em] text-white">
                      {card.title}
                    </h3>
                    <p className="mt-4 text-sm leading-6 text-white/62 sm:text-base sm:leading-7">
                      {card.description}
                    </p>
                    <p className="mt-6 rounded-full border border-white/10 bg-white/[0.045] px-3 py-1.5 font-mono text-[0.68rem] font-medium uppercase tracking-[0.14em] text-white/42">
                      {card.badge}
                    </p>
                  </div>
                </article>
              ))}
            </div>

            <aside className="relative overflow-hidden rounded-[2rem] border border-white/12 bg-[#080b16]/72 p-5 shadow-[0_28px_90px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:p-6 lg:p-7">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_24%_0%,rgba(125,211,168,0.12),transparent_34%),radial-gradient(circle_at_100%_100%,rgba(179,172,243,0.11),transparent_34%)]" />
              <div className="relative flex h-full flex-col">
                <div className="mb-8 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-2xl border border-[#7dd3a8]/20 bg-[#7dd3a8]/10 text-[#bceccc] shadow-[0_0_30px_rgba(125,211,168,0.12)]">
                      <Boxes className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#b3acf3]">
                        Foundation manifest
                      </p>
                      <p className="mt-1 text-sm text-white/48">
                        Generated once, then evolved through the workflow.
                      </p>
                    </div>
                  </div>
                  <FileCode2 className="hidden h-5 w-5 text-white/28 sm:block" />
                </div>

                <div className="divide-y divide-white/8 overflow-hidden rounded-2xl border border-white/10 bg-[#050712]/58">
                  {foundationManifestRows.map(([label, value]) => (
                    <div
                      key={label}
                      className="grid gap-2 px-4 py-4 text-sm sm:grid-cols-[0.72fr_1fr] sm:items-center"
                    >
                      <span className="font-mono text-[0.68rem] font-medium uppercase tracking-[0.16em] text-white/36">
                        {label}
                      </span>
                      <span className="text-white/74">{value}</span>
                    </div>
                  ))}
                </div>

                <p className="mt-auto pt-7 text-sm leading-6 text-white/54">
                  Not throwaway code from a prompt — a clean engineering
                  baseline for agents to build, test, preview, review, and
                  improve safely.
                </p>
              </div>
            </aside>
          </div>

          <p className="mx-auto mt-12 max-w-3xl text-center text-xl font-semibold leading-8 tracking-[-0.03em] text-white sm:text-2xl">
            Generated once. Built to evolve.
          </p>
        </div>
      </section>

      <section
        id="download"
        aria-labelledby="final-cta-title"
        className="relative isolate overflow-hidden px-5 py-24 sm:px-8 sm:py-32 lg:px-10"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-white/14 to-transparent" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[36rem] w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#b3acf3]/12 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-1/2 -z-10 h-64 w-[54rem] -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,rgba(125,211,168,0.1),transparent_68%)]" />

        <div className="mx-auto max-w-[980px] overflow-hidden rounded-[2rem] border border-white/12 bg-white/[0.045] p-6 text-center shadow-[0_34px_120px_rgba(0,0,0,0.36)] backdrop-blur-2xl sm:p-10 lg:p-14">
          <div className="pointer-events-none mx-auto mb-8 h-px max-w-sm bg-gradient-to-r from-transparent via-[#b3acf3]/50 to-transparent" />
          <h2
            id="final-cta-title"
            className="text-balance text-[clamp(2.7rem,6vw,6rem)] font-semibold leading-[0.92] tracking-[-0.08em] text-white"
          >
            Give agents work.
            <br />
            Keep engineering control.
          </h2>
          <p className="mx-auto mt-7 max-w-[720px] text-balance text-base leading-7 text-white/70 sm:text-lg md:text-xl">
            Run AI agents inside isolated worktrees, preview their output,
            review every diff, and merge only when you are ready.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href="#download"
              className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold tracking-[-0.01em] text-[#080b16] shadow-[0_18px_60px_rgba(255,255,255,0.22)] transition duration-200 hover:-translate-y-0.5 hover:bg-[#bdc3fd] focus:outline-none focus:ring-2 focus:ring-[#b3acf3] focus:ring-offset-2 focus:ring-offset-[#050712]"
            >
              Download Blame
              <ArrowRight className="h-4 w-4 transition duration-200 group-hover:translate-x-0.5" />
            </a>
            <a
              href="#workflow"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/14 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-white/90 backdrop-blur-md transition duration-200 hover:-translate-y-0.5 hover:bg-white/[0.1] focus:outline-none focus:ring-2 focus:ring-white/45 focus:ring-offset-2 focus:ring-offset-[#050712]"
            >
              <Play className="h-4 w-4 fill-current" />
              See the workflow
            </a>
          </div>

          <p className="mt-7 text-sm font-medium tracking-[-0.01em] text-white/50 sm:text-base">
            Desktop-first. Cloud-synced. Local execution.
          </p>
        </div>
      </section>
    </main>
  );
}

function SceneWarmup() {
  return (
    <div
      aria-hidden="true"
      className="scene-warmup pointer-events-none absolute inset-0 z-0 overflow-hidden bg-[#050712]"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_38%,rgba(179,172,243,0.22),transparent_28%),linear-gradient(180deg,rgba(5,7,18,0.7),rgba(5,7,18,0.92))]" />
      <div className="absolute inset-x-0 top-[42%] h-px overflow-hidden bg-white/[0.08]">
        <div className="scene-warmup-scan h-full w-2/3 bg-gradient-to-r from-transparent via-[#d7d2ff]/70 to-transparent shadow-[0_0_26px_rgba(179,172,243,0.65)]" />
      </div>
    </div>
  )
}

function SiteHeader() {
  return (
    <header className="landing-reveal landing-reveal-header fixed inset-x-0 top-0 z-30">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-10">
        <a
          href="#top"
          className="group flex items-center gap-3 rounded-full focus:outline-none focus:ring-2 focus:ring-white/50 focus:ring-offset-2 focus:ring-offset-[#050712]"
          aria-label="Blame accueil"
        >
          <span className="grid h-10 w-10 place-items-center">
            <Image
              src="/icons/blame-icon-256.png"
              alt=""
              width={40}
              height={40}
              className="h-10 w-10 object-contain"
              priority
            />
          </span>
          <span className="text-2xl font-extrabold tracking-[-0.05em] text-white">
            Blame
          </span>
        </a>

        <nav
          aria-label="Navigation principale"
          className="hidden items-center gap-1 rounded-full border border-white/10 bg-[#070a15]/35 p-1 text-sm text-white/70 shadow-2xl shadow-black/20 backdrop-blur-xl md:flex"
        >
          {navigationItems.map((item) => (
            <a
              key={item}
              href={`#${item.toLowerCase()}`}
              className="rounded-full px-4 py-2 transition duration-200 hover:bg-white/[0.08] hover:text-white focus:outline-none focus:ring-2 focus:ring-white/40"
            >
              {item}
            </a>
          ))}
        </nav>

        <a
          href="#waitlist"
          className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/14 bg-white/[0.08] px-4 text-sm font-semibold text-white/90 shadow-2xl shadow-black/20 backdrop-blur-xl transition duration-200 hover:bg-white/[0.14] focus:outline-none focus:ring-2 focus:ring-[#b3acf3] focus:ring-offset-2 focus:ring-offset-[#050712]"
        >
          Early access
        </a>
      </div>
    </header>
  )
}

function ProductMockup() {
  return (
    <div className="landing-reveal landing-reveal-mockup pointer-events-none z-20 mx-auto mb-4 w-full max-w-5xl">
      <div className="rounded-2xl border border-white/16 bg-white/[0.08] p-2 shadow-[0_32px_120px_rgba(0,0,0,0.55)] backdrop-blur-2xl sm:p-3">
        <div className="overflow-hidden rounded-xl border border-white/10 bg-[#080b16]/92 shadow-inner">
          <Image
            src="/desktop-backlog.png"
            alt="Blame backlog desktop interface"
            width={2450}
            height={1385}
            className="h-auto w-full"
            priority
          />
        </div>
      </div>
    </div>
  )
}
