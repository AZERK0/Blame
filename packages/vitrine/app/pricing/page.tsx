import type { Metadata } from 'next'
import { HelpCircle } from 'lucide-react'

import { LandingRevealStyles } from '@/components/landing-reveal-styles'
import { PricingCard } from '@/components/pricing-card'
import { SceneWarmup } from '@/components/scene-warmup'
import { SiteHeader } from '@/components/site-header'
import { HeroScene } from '../scene/hero-scene'

export const metadata: Metadata = {
  title: 'Pricing · Blame',
  description: 'Simple pricing for Blame: one plan for agentic development workflows.',
}

const faqItems = [
  {
    question: 'What is included in the plan?',
    answer:
      'The plan includes the Blame desktop workflow, isolated agent worktrees, live previews, diff review, synced backlog state, and project-level coding practices.',
  },
  {
    question: 'Can I switch between monthly and yearly billing?',
    answer:
      'Yes. You can choose monthly billing at €13 per month or yearly billing at €120 per year and switch when your subscription renews.',
  },
  {
    question: 'Does Blame run code in the cloud?',
    answer:
      'No. Code execution stays local in your worktrees. The cloud syncs your control plane: backlog, user stories, practices, and workspace state.',
  },
  {
    question: 'Do I need a separate AI provider account?',
    answer:
      'Yes. Blame orchestrates the development workflow around your AI coding agents and providers, so provider usage may be billed separately by those providers.',
  },
]

export default function PricingPage() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[#050712] text-white">
      <section
        id="pricing"
        aria-labelledby="pricing-title"
        className="hero-stage relative isolate min-h-screen overflow-hidden px-5 pb-24 pt-24 sm:px-8 lg:px-10"
      >
        <HeroScene terrainPreset="pricing" />
        <SceneWarmup />
        <div className="pointer-events-none absolute -inset-8 -z-10 backdrop-blur-[12px] [mask-image:radial-gradient(ellipse_at_center,transparent_0%,transparent_48%,black_78%)]" />
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(2,4,10,0.1)_0%,rgba(2,4,10,0.26)_42%,rgba(2,4,10,0.58)_74%,rgba(2,4,10,0.9)_100%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-56 bg-gradient-to-b from-[#050712]/64 to-transparent" />
        <div className="pointer-events-none absolute bottom-0 left-1/2 -z-10 h-[32rem] w-[44rem] -translate-x-1/2 rounded-full bg-[#b3acf3]/10 blur-3xl" />

        <SiteHeader />

        <div className="relative z-10 mx-auto flex min-h-[calc(100vh-6rem)] w-full max-w-7xl flex-col items-center justify-center">
          <div className="mx-auto max-w-4xl text-center">
            <div className="landing-reveal landing-reveal-eyebrow mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-white/14 bg-white/[0.07] px-3 py-1.5 text-xs font-medium uppercase tracking-[0.32em] text-white/76 shadow-2xl shadow-black/30 backdrop-blur-md">
              <span className="h-1.5 w-1.5 rounded-full bg-[#b3acf3] shadow-[0_0_18px_rgba(179,172,243,0.9)]" />
              Simple pricing
            </div>
            <h1
              id="pricing-title"
              className="landing-reveal landing-reveal-title text-balance text-[clamp(3.2rem,8vw,7.5rem)] font-semibold leading-[0.9] tracking-[-0.09em] text-white drop-shadow-[0_20px_70px_rgba(0,0,0,0.55)]"
            >
              One plan.
              <br />
              Full agent control.
            </h1>
            <p className="landing-reveal landing-reveal-copy mx-auto mt-7 max-w-2xl text-balance text-base leading-7 text-white/76 sm:text-lg md:text-xl">
              Everything you need to run AI coding agents in isolated worktrees,
              preview their output, and merge only when the work is ready.
            </p>
          </div>

          <PricingCard />
        </div>

        <LandingRevealStyles />
      </section>

      <section
        aria-labelledby="pricing-faq-title"
        className="relative isolate overflow-hidden px-5 pb-24 pt-10 sm:px-8 sm:pb-32 lg:px-10"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-white/14 to-transparent" />
        <div className="mx-auto max-w-4xl">
          <div className="text-center">
            <div className="mx-auto mb-5 grid h-11 w-11 place-items-center rounded-2xl border border-white/12 bg-white/[0.06] text-[#d7d2ff] shadow-[0_0_34px_rgba(179,172,243,0.12)] backdrop-blur-xl">
              <HelpCircle className="h-5 w-5" />
            </div>
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.36em] text-[#b3acf3]">
              FAQ
            </p>
            <h2
              id="pricing-faq-title"
              className="text-balance text-[clamp(2.3rem,5vw,4.5rem)] font-semibold leading-[0.95] tracking-[-0.07em] text-white"
            >
              Common pricing questions.
            </h2>
          </div>

          <div className="mt-12 divide-y divide-white/10 overflow-hidden rounded-[2rem] border border-white/12 bg-white/[0.045] shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl">
            {faqItems.map((item) => (
              <details key={item.question} className="group p-6 open:bg-white/[0.025] sm:p-7">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-5 text-left text-lg font-semibold tracking-[-0.025em] text-white marker:hidden">
                  {item.question}
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/12 bg-white/[0.055] text-white/56 transition duration-200 group-open:rotate-45 group-open:text-[#d7d2ff]">
                    +
                  </span>
                </summary>
                <p className="mt-4 max-w-3xl text-sm leading-7 text-white/62 sm:text-base">
                  {item.answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}