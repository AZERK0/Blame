import { ArrowRight, GitBranch, Play, ShieldCheck } from 'lucide-react'
import { HeroScene } from './scene/hero-scene'

const navigationItems = ['Produit', 'Workflow', 'Sécurité']

const workflowColumns = [
  {
    title: 'Backlog',
    items: ['Story prête', 'Critères cadrés', 'Contexte attaché'],
    tone: 'from-sky-400/30',
  },
  {
    title: 'Worktree',
    items: ['Agent actif', 'Règles projet', 'Preview isolée'],
    tone: 'from-[#b3acf3]/35',
  },
  {
    title: 'Diff',
    items: ['Tests relancés', 'Risques visibles', 'Merge validé'],
    tone: 'from-emerald-300/30',
  },
]

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#050712] text-white">
      <section
        id="top"
        aria-labelledby="hero-title"
        className="relative isolate min-h-screen overflow-hidden"
      >
        <HeroScene />
        <div className="pointer-events-none absolute -inset-8 -z-10 backdrop-blur-[12px] [mask-image:radial-gradient(ellipse_at_center,transparent_0%,transparent_48%,black_78%)]" />
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(2,4,10,0.12)_0%,rgba(2,4,10,0.24)_42%,rgba(2,4,10,0.52)_72%,rgba(2,4,10,0.86)_100%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-56 bg-gradient-to-b from-[#050712]/64 to-transparent" />

        <SiteHeader />

        <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-9xl flex-col px-5 pb-6 pt-24 sm:px-8 lg:px-10">
          <div className="flex flex-1 items-center justify-center pb-[34vh] pt-8 sm:pb-[30vh] lg:pb-[26vh]">
            <div className="text-center">
              <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-white/14 bg-white/[0.07] px-3 py-1.5 text-xs font-medium uppercase tracking-[0.32em] text-white/76 shadow-2xl shadow-black/30 backdrop-blur-md">
                <span className="h-1.5 w-1.5 rounded-full bg-[#b3acf3] shadow-[0_0_18px_rgba(179,172,243,0.9)]" />
                Agentic IDE
              </div>
              <h1
                id="hero-title"
                className="text-balance text-[clamp(3.4rem,10vw,9.5rem)] font-semibold leading-[0.9] tracking-[-0.095em] text-white drop-shadow-[0_20px_70px_rgba(0,0,0,0.55)]"
              >
                The industrial-grade
                <br />
                agentic IDE.
              </h1>
              <p className="mx-auto mt-7 max-w-2xl text-balance text-base leading-7 text-white/76 sm:text-lg md:text-xl">
                Transforme chaque demande en worktree testable, avec preview,
                diff et merge validé — sans perdre le fil de ton code.
              </p>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <a
                  href="#waitlist"
                  className="group inline-flex min-h-12 items-center justify-centerleading-[0.82] tracking-[-0.095em] gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-[#080b16] shadow-[0_18px_60px_rgba(255,255,255,0.22)] transition duration-200 hover:-translate-y-0.5 hover:bg-[#bdc3fd] focus:outline-none focus:ring-2 focus:ring-[#b3acf3] focus:ring-offset-2 focus:ring-offset-[#050712]"
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
      </section>
    </main>
  );
}

function SiteHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-30">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-10">
        <a
          href="#top"
          className="group flex items-center gap-3 rounded-full focus:outline-none focus:ring-2 focus:ring-white/50 focus:ring-offset-2 focus:ring-offset-[#050712]"
          aria-label="Blame accueil"
        >
          <span className="grid h-10 w-10 place-items-center rounded-2xl border border-white/12 bg-white/[0.08] text-sm font-black tracking-[-0.16em] shadow-2xl shadow-black/25 backdrop-blur-md transition duration-200 group-hover:bg-white/[0.12]">
            B/
          </span>
          <span className="text-lg font-semibold tracking-[-0.05em] text-white">
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
    <div className="pointer-events-none absolute inset-x-4 bottom-6 z-20 mx-auto max-w-5xl sm:bottom-8 lg:bottom-10">
      <div className="rounded-[2rem] border border-white/16 bg-white/[0.08] p-2 shadow-[0_32px_120px_rgba(0,0,0,0.55)] backdrop-blur-2xl sm:rounded-[2.5rem] sm:p-3">
        <div className="overflow-hidden rounded-[1.55rem] border border-white/10 bg-[#080b16]/92 shadow-inner sm:rounded-[2rem]">
          <div className="flex items-center justify-between border-b border-white/8 bg-white/[0.04] px-4 py-3 sm:px-5">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff6b6b]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#b3acf3]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#5ee6a8]" />
            </div>
            <div className="hidden items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-emerald-100 sm:flex">
              <ShieldCheck className="h-3.5 w-3.5" />
              Preview ready
            </div>
          </div>

          <div className="grid min-h-[210px] grid-cols-1 gap-3 p-3 sm:min-h-[280px] sm:grid-cols-3 sm:p-5 lg:min-h-[340px] lg:gap-4">
            {workflowColumns.map((column) => (
              <div
                key={column.title}
                className="relative overflow-hidden rounded-3xl border border-white/9 bg-white/[0.045] p-4"
              >
                <div
                  className={`absolute inset-x-0 top-0 h-24 bg-gradient-to-b ${column.tone} to-transparent opacity-80`}
                />
                <div className="relative flex items-center justify-between">
                  <p className="text-sm font-semibold tracking-[-0.02em] text-white">
                    {column.title}
                  </p>
                  <GitBranch className="h-4 w-4 text-white/45" />
                </div>
                <div className="relative mt-5 space-y-2.5">
                  {column.items.map((item, index) => (
                    <div
                      key={item}
                      className="rounded-2xl border border-white/8 bg-black/20 p-3"
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-white/60" />
                        <span className="text-xs font-medium text-white/78">
                          {item}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-white/35 via-[#bdc3fd]/75 to-emerald-200/80"
                          style={{ width: `${48 + index * 18}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
