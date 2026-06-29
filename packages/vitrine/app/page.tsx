import Image from 'next/image'
import { ArrowRight, Play } from 'lucide-react'
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
