import type { Metadata } from 'next'
import { CheckCircle2 } from 'lucide-react'

import { LandingRevealStyles } from '@/components/landing-reveal-styles'
import { SceneWarmup } from '@/components/scene-warmup'
import { SiteHeader } from '@/components/site-header'
import { HeroScene } from '../scene/hero-scene'
import { DownloadClientSection } from './download-client-section'

export const metadata: Metadata = {
  title: 'Download · Blame',
  description:
    'Download the latest Blame desktop app for macOS, Windows, and Linux.',
}

type DownloadArtifact = {
  id: 'macos-arm64' | 'macos-x64' | 'windows-x64' | 'linux-x86_64'
  os: 'macos' | 'windows' | 'linux'
  platform: string
  architecture: string
  fileName: string
  size: string
  updatedAt: string
}

const primaryArtifacts = [
  {
    id: 'macos-arm64',
    os: 'macos',
    platform: 'macOS',
    architecture: 'Apple silicon',
    fileName: 'blame-mac-arm64.dmg',
    size: '269M',
    updatedAt: '16 Jun 2026',
  },
  {
    id: 'macos-x64',
    os: 'macos',
    platform: 'macOS',
    architecture: 'Intel',
    fileName: 'blame-mac-x64.dmg',
    size: '277M',
    updatedAt: '16 Jun 2026',
  },
  {
    id: 'windows-x64',
    os: 'windows',
    platform: 'Windows',
    architecture: 'x64',
    fileName: 'blame-win-x64.exe',
    size: '215M',
    updatedAt: '28 Jun 2026',
  },
  {
    id: 'linux-x86_64',
    os: 'linux',
    platform: 'Linux',
    architecture: 'x86_64',
    fileName: 'blame-linux-x86_64.AppImage',
    size: '295M',
    updatedAt: '28 Jun 2026',
  },
] satisfies DownloadArtifact[]

export default function DownloadPage() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[#050712] text-white">
      <section
        id="download"
        aria-labelledby="download-title"
        className="hero-stage relative isolate min-h-screen overflow-hidden px-5 pb-24 pt-24 sm:px-8 lg:px-10"
      >
        <HeroScene terrainPreset="download" />
        <SceneWarmup />
        <div className="pointer-events-none absolute -inset-8 -z-10 backdrop-blur-[12px] [mask-image:radial-gradient(ellipse_at_center,transparent_0%,transparent_48%,black_78%)]" />
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(2,4,10,0.1)_0%,rgba(2,4,10,0.26)_42%,rgba(2,4,10,0.58)_74%,rgba(2,4,10,0.9)_100%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-56 bg-gradient-to-b from-[#050712]/64 to-transparent" />
        <div className="pointer-events-none absolute bottom-0 left-1/2 -z-10 h-[34rem] w-[48rem] -translate-x-1/2 rounded-full bg-[#9fd7ff]/10 blur-3xl" />

        <SiteHeader />

        <div className="relative z-10 mx-auto grid min-h-[calc(100vh-6rem)] w-full max-w-7xl items-center gap-12 py-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <div>
            <h1
              id="download-title"
              className="landing-reveal landing-reveal-title max-w-4xl text-balance text-[clamp(3.2rem,8vw,7.5rem)] font-semibold leading-[0.9] tracking-tighter text-white drop-shadow-[0_20px_70px_rgba(0,0,0,0.55)] sm:leading-32"
            >
              Download Blame.
            </h1>
            <p className="landing-reveal landing-reveal-copy mt-7 max-w-2xl text-balance text-base leading-7 text-white/76 sm:text-lg md:text-xl">
              Install the desktop app and keep agent execution close to your
              code: isolated worktrees, live previews, diffs, and controlled
              merges on your machine.
            </p>

            <DownloadClientSection artifacts={primaryArtifacts} mode="actions" />
          </div>

          <div
            id="all-downloads"
            className="landing-reveal landing-reveal-actions scroll-mt-28"
          >
            <div className="relative overflow-hidden rounded-[2rem] border border-white/18 bg-white/[0.08] p-2 shadow-[0_34px_120px_rgba(0,0,0,0.42)] backdrop-blur-2xl">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(255,255,255,0.18),transparent_28%),radial-gradient(circle_at_80%_18%,rgba(159,215,255,0.2),transparent_36%)]" />
              <div className="relative rounded-[1.55rem] border border-white/14 bg-[#f7f7f8]/90 p-5 text-[#111] shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_18px_60px_rgba(0,0,0,0.24)] backdrop-blur-xl sm:p-6">
                <div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#111]/48">
                      Installers
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#111]">
                      Latest builds
                    </h2>
                  </div>
                </div>

                <DownloadClientSection artifacts={primaryArtifacts} mode="cards" />
              </div>
            </div>
          </div>
        </div>

        <LandingRevealStyles />
      </section>
    </main>
  )
}

export type { DownloadArtifact }