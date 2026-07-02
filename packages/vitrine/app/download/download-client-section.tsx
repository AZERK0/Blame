'use client'

import { useMemo, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { Apple, ArrowRight, Download, Monitor, MonitorDown } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { DownloadArtifact } from './page'

const downloadBaseUrl = 'https://download.blame.raphael-charpentier.fr/latest'

type DetectedOs = DownloadArtifact['os']

type DownloadClientSectionProps = {
  artifacts: DownloadArtifact[]
  mode: 'actions' | 'cards'
}

const osLabels = {
  macos: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
} satisfies Record<DetectedOs, string>

export function DownloadClientSection({ artifacts, mode }: DownloadClientSectionProps) {
  const detectedOs = useDetectedOs()
  const recommendedArtifact = useMemo(
    () => selectRecommendedArtifact(artifacts, detectedOs),
    [artifacts, detectedOs],
  )

  if (mode === 'actions') {
    return <DownloadActions artifact={recommendedArtifact} />
  }

  const artifactGroups = groupArtifactsForOs(artifacts, detectedOs)

  return (
    <div className="mt-6 grid gap-3">
      {artifactGroups.map((group) => (
        <div
          key={group.os}
          className="grid gap-3 sm:data-[macos=true]:grid-cols-2"
          data-macos={group.os === 'macos'}
        >
          {group.artifacts.map((artifact) => (
            <DownloadCard
              key={artifact.fileName}
              artifact={artifact}
              isRecommended={artifact.id === recommendedArtifact.id}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function DownloadActions({ artifact }: { artifact: DownloadArtifact }) {
  const DownloadIcon = artifact.os === 'macos' ? Apple : Monitor

  return (
    <div className="landing-reveal landing-reveal-actions mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
      <Link
        href={artifactUrl(artifact.fileName)}
        className={cn(
          buttonVariants(),
          'min-h-14 px-7 py-4 text-base shadow-[0_22px_70px_rgba(255,255,255,0.26)] sm:text-lg',
        )}
      >
        <DownloadIcon className="h-5 w-5" />
        Download for {osLabels[artifact.os]}
        <ArrowRight className="h-5 w-5" />
      </Link>
    </div>
  )
}

function DownloadCard({
  artifact,
  isRecommended,
}: {
  artifact: DownloadArtifact
  isRecommended: boolean
}) {
  return (
    <Link
      href={artifactUrl(artifact.fileName)}
      className="group block rounded-2xl border border-black/8 bg-white p-4 shadow-[0_12px_34px_rgba(0,0,0,0.08)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_44px_rgba(0,0,0,0.14)] focus:outline-none focus:ring-2 focus:ring-[#111]/20 data-[recommended=true]:border-[#111]/18 data-[recommended=true]:bg-[#111] data-[recommended=true]:text-white data-[recommended=true]:shadow-[0_22px_58px_rgba(0,0,0,0.24)]"
      data-macos={artifact.os === 'macos'}
      data-recommended={isRecommended}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold tracking-[-0.03em] text-[#111] group-data-[recommended=true]:text-white">
              {artifact.platform}
            </h3>
            <span className="rounded-full bg-black/[0.06] px-2.5 py-1 text-xs font-semibold text-[#111]/62 group-data-[recommended=true]:bg-white/12 group-data-[recommended=true]:text-white/74">
              {artifact.architecture}
            </span>
            {isRecommended ? (
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-[#111]">
                For this device
              </span>
            ) : null}
          </div>
          <p className="mt-3 break-all font-mono text-xs text-[#111]/44 group-data-[recommended=true]:text-white/44">
            {artifact.fileName}
          </p>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-4 sm:block sm:text-right">
          <div>
            <p className="text-sm font-semibold text-[#111] group-data-[recommended=true]:text-white">
              {artifact.size}
            </p>
            <p className="mt-1 text-xs text-[#111]/44 group-data-[recommended=true]:text-white/44">
              {artifact.updatedAt}
            </p>
          </div>
          <span className="mt-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#111] text-white transition duration-200 group-hover:scale-105 group-data-[recommended=true]:bg-white group-data-[recommended=true]:text-[#111]">
            <Download className="h-4 w-4" />
          </span>
        </div>
      </div>
    </Link>
  )
}

function useDetectedOs() {
  return useSyncExternalStore(subscribeToStaticOs, detectOs, getServerOs)
}

function subscribeToStaticOs() {
  return () => undefined
}

function getServerOs(): DetectedOs {
  return 'macos'
}

function detectOs(): DetectedOs {
  const userAgentDataPlatform = getUserAgentDataPlatform()
  const platform = (userAgentDataPlatform || navigator.platform || '').toLowerCase()
  const userAgent = navigator.userAgent.toLowerCase()
  const osSource = `${platform} ${userAgent}`

  if (/win/.test(osSource)) {
    return 'windows'
  }

  if (/linux|x11/.test(osSource)) {
    return 'linux'
  }

  return 'macos'
}

function getUserAgentDataPlatform() {
  const navigatorWithUserAgentData = navigator as Navigator & {
    userAgentData?: { platform?: string }
  }

  return navigatorWithUserAgentData.userAgentData?.platform
}

function selectRecommendedArtifact(
  artifacts: DownloadArtifact[],
  detectedOs: DetectedOs,
) {
  return (
    artifacts.find((artifact) => artifact.os === detectedOs) ??
    artifacts.find((artifact) => artifact.os === 'macos') ??
    artifacts[0]
  )
}

function groupArtifactsForOs(
  artifacts: DownloadArtifact[],
  detectedOs: DetectedOs,
) {
  const sortedArtifacts = sortArtifactsForOs(artifacts, detectedOs)
  const groups: { os: DetectedOs; artifacts: DownloadArtifact[] }[] = []

  for (const artifact of sortedArtifacts) {
    const existingGroup = groups.find((group) => group.os === artifact.os)

    if (existingGroup) {
      existingGroup.artifacts.push(artifact)
      continue
    }

    groups.push({ os: artifact.os, artifacts: [artifact] })
  }

  return groups
}

function sortArtifactsForOs(
  artifacts: DownloadArtifact[],
  detectedOs: DetectedOs,
) {
  return [...artifacts].sort((left, right) => {
    const osRankDifference =
      osPriority(left.os, detectedOs) - osPriority(right.os, detectedOs)

    if (osRankDifference !== 0) {
      return osRankDifference
    }

    return artifactArchitectureRank(left) - artifactArchitectureRank(right)
  })
}

function osPriority(os: DetectedOs, detectedOs: DetectedOs) {
  if (os === detectedOs) {
    return 0
  }

  const defaultPriority = { macos: 1, windows: 2, linux: 3 }

  return defaultPriority[os]
}

function artifactArchitectureRank(artifact: DownloadArtifact) {
  if (artifact.id === 'macos-arm64') {
    return 0
  }

  if (artifact.id === 'macos-x64') {
    return 1
  }

  return 0
}

function artifactUrl(fileName: string) {
  return `${downloadBaseUrl}/${fileName}`
}