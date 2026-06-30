import type { Metadata } from 'next'
import Link from 'next/link'
import {
  Apple,
  ArrowRight,
  CheckCircle2,
  Download,
  FileArchive,
  MonitorDown,
  ShieldCheck,
  Terminal,
} from 'lucide-react'

import { LandingRevealStyles } from '@/components/landing-reveal-styles'
import { SceneWarmup } from '@/components/scene-warmup'
import { SiteHeader } from '@/components/site-header'
import { buttonVariants } from '@/components/ui/button'
import { HeroScene } from '../scene/hero-scene'

export const metadata: Metadata = {
  title: 'Download · Blame',
  description:
    'Download the latest Blame desktop app for macOS, Windows, and Linux.',
}

const downloadBaseUrl = 'https://download.blame.raphael-charpentier.fr/latest'

type DownloadArtifact = {
  platform: string
  architecture: string
  fileName: string
  size: string
  updatedAt: string
  description: string
  recommended?: boolean
}

type SecondaryArtifact = {
  label: string
  fileName: string
  size: string
}

const primaryArtifacts = [
  {
    platform: 'macOS',
    architecture: 'Apple silicon',
    fileName: 'blame-mac-arm64.dmg',
    size: '269M',
    updatedAt: '16 Jun 2026',
    description: 'Recommended for M1, M2, M3, and newer Mac machines.',
    recommended: true,
  },
  {
    platform: 'macOS',
    architecture: 'Intel',
    fileName: 'blame-mac-x64.dmg',
    size: '277M',
    updatedAt: '16 Jun 2026',
    description: 'Installer for Intel-based Mac machines.',
  },
  {
    platform: 'Windows',
    architecture: 'x64',
    fileName: 'blame-win-x64.exe',
    size: '215M',
    updatedAt: '28 Jun 2026',
    description: 'Desktop installer for 64-bit Windows workstations.',
  },
  {
    platform: 'Linux',
    architecture: 'x86_64',
    fileName: 'blame-linux-x86_64.AppImage',
    size: '295M',
    updatedAt: '28 Jun 2026',
    description: 'Portable AppImage for 64-bit Linux distributions.',
  },
] satisfies DownloadArtifact[]

const secondaryArtifacts = [
  { label: 'macOS Apple silicon zip', fileName: 'blame-mac-arm64.zip', size: '260M' },
  { label: 'macOS Intel zip', fileName: 'blame-mac-x64.zip', size: '268M' },
  { label: 'Windows update metadata', fileName: 'latest.yml', size: '331B' },
  { label: 'macOS update metadata', fileName: 'latest-mac.yml', size: '780B' },
  { label: 'Linux update metadata', fileName: 'latest-linux.yml', size: '376B' },
] satisfies SecondaryArtifact[]

const trustItems = [
  'Latest channel hosted by Blame release infrastructure',
  'Local-first desktop execution for code, servers, and worktrees',
  'Separate installers for macOS, Windows, and Linux environments',
]

export default function DownloadPage() {
  const recommendedArtifact = primaryArtifacts[0]

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#050712] text-white">
      <section
        id="download"
        aria-labelledby="download-title"
        className="hero-stage relative isolate min-h-screen overflow-hidden px-5 pb-24 pt-24 sm:px-8 lg:px-10"
      >
        <HeroScene terrainPreset="pricing" />
        <SceneWarmup />
        <div className="pointer-events-none absolute -inset-8 -z-10 backdrop-blur-[12px] [mask-image:radial-gradient(ellipse_at_center,transparent_0%,transparent_48%,black_78%)]" />
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(2,4,10,0.1)_0%,rgba(2,4,10,0.26)_42%,rgba(2,4,10,0.58)_74%,rgba(2,4,10,0.9)_100%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-56 bg-gradient-to-b from-[#050712]/64 to-transparent" />
        <div className="pointer-events-none absolute bottom-0 left-1/2 -z-10 h-[34rem] w-[48rem] -translate-x-1/2 rounded-full bg-[#9fd7ff]/10 blur-3xl" />

        <SiteHeader />

        <div className="relative z-10 mx-auto grid min-h-[calc(100vh-6rem)] w-full max-w-7xl items-center gap-12 py-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <div>
            <div className="landing-reveal landing-reveal-eyebrow mb-5 inline-flex items-center gap-2 rounded-full border border-white/14 bg-white/[0.07] px-3 py-1.5 text-xs font-medium uppercase tracking-[0.32em] text-white/76 shadow-2xl shadow-black/30 backdrop-blur-md">
              <span className="h-1.5 w-1.5 rounded-full bg-[#9fd7ff] shadow-[0_0_18px_rgba(159,215,255,0.9)]" />
              Latest desktop release
            </div>
            <h1
              id="download-title"
              className="landing-reveal landing-reveal-title max-w-4xl text-balance text-[clamp(3.2rem,8vw,7.5rem)] font-semibold leading-[0.9] tracking-[-0.09em] text-white drop-shadow-[0_20px_70px_rgba(0,0,0,0.55)]"
            >
              Download Blame.
              <br />
              Run agents locally.
            </h1>
            <p className="landing-reveal landing-reveal-copy mt-7 max-w-2xl text-balance text-base leading-7 text-white/76 sm:text-lg md:text-xl">
              Install the desktop app and keep agent execution close to your
              code: isolated worktrees, live previews, diffs, and controlled
              merges on your machine.
            </p>

            <div className="landing-reveal landing-reveal-actions mt-9 flex flex-col gap-3 sm:flex-row">
              <Link
                href={artifactUrl(recommendedArtifact.fileName)}
                className={buttonVariants()}
              >
                <Apple className="h-4 w-4" />
                Download for macOS
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#all-downloads"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/14 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-white/90 backdrop-blur-md transition duration-200 hover:-translate-y-0.5 hover:bg-white/[0.1] focus:outline-none focus:ring-2 focus:ring-white/45 focus:ring-offset-2 focus:ring-offset-[#050505]"
              >
                <MonitorDown className="h-4 w-4" />
                Choose another platform
              </a>
            </div>

            <ul className="landing-reveal landing-reveal-copy mt-8 grid gap-3 text-sm leading-6 text-white/62">
              {trustItems.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#92d8bf]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div
            id="all-downloads"
            className="landing-reveal landing-reveal-actions scroll-mt-28"
          >
            <div className="relative overflow-hidden rounded-[2rem] border border-white/18 bg-white/[0.08] p-2 shadow-[0_34px_120px_rgba(0,0,0,0.42)] backdrop-blur-2xl">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(255,255,255,0.18),transparent_28%),radial-gradient(circle_at_80%_18%,rgba(159,215,255,0.2),transparent_36%)]" />
              <div className="relative rounded-[1.55rem] border border-white/14 bg-[#f7f7f8]/90 p-5 text-[#111] shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_18px_60px_rgba(0,0,0,0.24)] backdrop-blur-xl sm:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#111]/48">
                      Installers
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#111]">
                      Latest builds
                    </h2>
                  </div>
                  <span className="inline-flex w-fit items-center gap-2 rounded-full bg-[#111] px-3 py-1 text-xs font-semibold text-white">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    latest
                  </span>
                </div>

                <div className="mt-6 grid gap-3">
                  {primaryArtifacts.map((artifact) => (
                    <DownloadCard key={artifact.fileName} artifact={artifact} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <LandingRevealStyles />
      </section>

      <section className="relative isolate overflow-hidden px-5 pb-24 pt-10 sm:px-8 sm:pb-32 lg:px-10">
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-white/14 to-transparent" />
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
          <div>
            <div className="mb-5 grid h-11 w-11 place-items-center rounded-2xl border border-white/12 bg-white/[0.06] text-[#d7d2ff] shadow-[0_0_34px_rgba(179,172,243,0.12)] backdrop-blur-xl">
              <Terminal className="h-5 w-5" />
            </div>
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.36em] text-[#b3acf3]">
              Release files
            </p>
            <h2 className="max-w-3xl text-balance text-[clamp(2.3rem,5vw,4.5rem)] font-semibold leading-[0.95] tracking-[-0.07em] text-white">
              Need the zip or update metadata?
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-7 text-white/62 sm:text-lg">
              The direct latest channel also exposes portable macOS archives and
              updater manifests used by the desktop release process.
            </p>
          </div>

          <div className="grid gap-3 rounded-[2rem] border border-white/12 bg-white/[0.045] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:p-5">
            {secondaryArtifacts.map((artifact) => (
              <SecondaryDownloadLink key={artifact.fileName} artifact={artifact} />
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}

function DownloadCard({ artifact }: { artifact: DownloadArtifact }) {
  return (
    <Link
      href={artifactUrl(artifact.fileName)}
      className="group block rounded-2xl border border-black/8 bg-white p-4 shadow-[0_12px_34px_rgba(0,0,0,0.08)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_44px_rgba(0,0,0,0.14)] focus:outline-none focus:ring-2 focus:ring-[#111]/20"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold tracking-[-0.03em] text-[#111]">
              {artifact.platform}
            </h3>
            <span className="rounded-full bg-black/[0.06] px-2.5 py-1 text-xs font-semibold text-[#111]/62">
              {artifact.architecture}
            </span>
            {artifact.recommended ? (
              <span className="rounded-full bg-[#111] px-2.5 py-1 text-xs font-semibold text-white">
                Recommended
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-sm leading-6 text-[#111]/62">
            {artifact.description}
          </p>
          <p className="mt-3 break-all font-mono text-xs text-[#111]/44">
            {artifact.fileName}
          </p>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-4 sm:block sm:text-right">
          <p className="text-sm font-semibold text-[#111]">{artifact.size}</p>
          <p className="mt-1 text-xs text-[#111]/44">{artifact.updatedAt}</p>
          <span className="mt-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#111] text-white transition duration-200 group-hover:scale-105">
            <Download className="h-4 w-4" />
          </span>
        </div>
      </div>
    </Link>
  )
}

function SecondaryDownloadLink({ artifact }: { artifact: SecondaryArtifact }) {
  return (
    <Link
      href={artifactUrl(artifact.fileName)}
      className="group flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.055] p-4 transition duration-200 hover:-translate-y-0.5 hover:bg-white/[0.09] focus:outline-none focus:ring-2 focus:ring-white/35 sm:flex-row sm:items-center sm:justify-between"
    >
      <span className="flex min-w-0 items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/12 bg-white/[0.065] text-white/76">
          <FileArchive className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-white">{artifact.label}</span>
          <span className="mt-1 block break-all font-mono text-xs text-white/42">
            {artifact.fileName}
          </span>
        </span>
      </span>
      <span className="flex items-center justify-between gap-4 pl-13 sm:pl-0">
        <span className="text-sm font-medium text-white/58">{artifact.size}</span>
        <ArrowRight className="h-4 w-4 text-white/42 transition duration-200 group-hover:translate-x-0.5 group-hover:text-white" />
      </span>
    </Link>
  )
}

function artifactUrl(fileName: string) {
  return `${downloadBaseUrl}/${fileName}`
}