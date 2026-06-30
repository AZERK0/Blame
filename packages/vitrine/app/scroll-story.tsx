'use client'

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
  type LucideIcon,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react'
import { SceneWarmup } from '@/components/scene-warmup'
import { HeroScene } from './scene/hero-scene'

type StoryCard = {
  title: string
  description: string
  label?: string
}

type SpecialistAgent = StoryCard & {
  icon: LucideIcon
  color: string
}

type StoryScene = {
  eyebrow: string
  title: string
  description: string
  accent: string
  visual: 'cards' | 'workflow' | 'imageCards' | 'agents' | 'build' | 'cta'
  cards?: readonly StoryCard[]
}

type SceneMetrics = {
  local: number
  offset: number
  visibility: number
}

const storyStartProgress = 0.15
const totalScrollHeight = 1260
const scrollProgressResponse = 14

const agentChaosCards = [
  {
    title: 'Parallel agents collide',
    description:
      'Several agents become risky when they share one branch, one server, and one unfinished local state.',
  },
  {
    title: 'Worktrees are only the start',
    description:
      'Raw worktrees still need dependencies, env files, ports, commands, previews, and a task owner.',
  },
  {
    title: 'Context evaporates',
    description:
      'Chat prompts lose user stories, acceptance criteria, project rules, and the reason a change exists.',
  },
  {
    title: 'Generated code drifts',
    description:
      'Without local standards, agents optimize for a passing moment instead of the codebase you maintain.',
  },
] satisfies StoryCard[]

const parallelAgentCards = [
  {
    title: 'Story first',
    description:
      'Every request becomes a structured user story before the agent touches code.',
    label: '01',
  },
  {
    title: 'Workspace prepared',
    description:
      'Blame opens a dedicated branch and worktree, then prepares the runtime around it.',
    label: '02',
  },
  {
    title: 'Preview attached',
    description:
      'The result runs beside the task, with the diff and feedback loop close at hand.',
    label: '03',
  },
  {
    title: 'Merge controlled',
    description:
      'The developer reviews, requests changes, and merges only when the story is accepted.',
    label: '04',
  },
] satisfies StoryCard[]

const cloudWorkspaceCards = [
  {
    title: 'Backlog synced',
    description:
      'Stories, acceptance criteria, provider state, and workflow status follow you across machines.',
    label: 'sync/backlog',
  },
  {
    title: 'Execution stays local',
    description:
      'Worktrees, previews, diffs, servers, and code edits remain on the machine doing the work.',
    label: 'local/run',
  },
  {
    title: 'Standards remembered',
    description:
      'Project practices stay attached to the repository instead of living inside a forgotten prompt.',
    label: 'rules/project',
  },
] satisfies StoryCard[]

const codePracticeCards = [
  {
    title: 'Match the codebase',
    description:
      'Agents inherit naming, structure, and style from the repository before proposing new code.',
    label: 'Project screen',
  },
  {
    title: 'Protect behavior',
    description:
      'Testing expectations travel with the story so verification is planned before merge.',
    label: 'Quality gates',
  },
  {
    title: 'Respect architecture',
    description:
      'Layering, dependency direction, and project boundaries become part of the implementation context.',
    label: 'Project rules',
  },
] satisfies StoryCard[]

const specialistAgentCards = [
  {
    title: 'Codebase Analyst',
    description:
      'Maps structure, stack, conventions, dependencies, and affected files.',
    icon: Search,
    color: '#9fd7ff',
  },
  {
    title: 'Story Analyst',
    description:
      'Clarifies goals, acceptance criteria, constraints, and edge cases.',
    icon: ClipboardCheck,
    color: '#f7cf83',
  },
  {
    title: 'Frontend Specialist',
    description:
      'Checks hierarchy, responsiveness, accessibility, and product polish.',
    icon: Palette,
    color: '#f5a3b7',
  },
  {
    title: 'Test Analyst',
    description:
      'Plans commands, proof points, behaviors, and regression coverage.',
    icon: Code2,
    color: '#92d8bf',
  },
  {
    title: 'Risk Reviewer',
    description:
      'Looks for unsafe assumptions, data risks, and merge blockers.',
    icon: ShieldCheck,
    color: '#d5c7ff',
  },
] satisfies SpecialistAgent[]

const projectCreationCards = [
  {
    title: 'Choose the stack',
    description:
      'Frontend, backend, database, UI kit, ORM, package manager, and project shape.',
    label: '01',
  },
  {
    title: 'Generate the baseline',
    description:
      'Scripts, env templates, dependencies, tests, linting, and conventions arrive together.',
    label: '02',
  },
  {
    title: 'Start agent-ready',
    description:
      'Stories, worktrees, previews, diffs, reviews, and merges are part of day one.',
    label: '03',
  },
] satisfies StoryCard[]

const storyScenes = [
  {
    eyebrow: 'The agent chaos',
    title: 'AI coding is fast. Shipping it safely is the hard part.',
    description:
      'The challenge is no longer generating code. It is keeping agent work isolated, reviewable, and aligned with the standards of the project.',
    accent: '#f7cf83',
    visual: 'cards',
    cards: agentChaosCards,
  },
  {
    eyebrow: 'Parallel agent work',
    title: 'One request becomes a controlled engineering lane.',
    description:
      'Blame turns a task into a prepared workspace with a preview, a diff, and a deliberate path to merge.',
    accent: '#9fd7ff',
    visual: 'workflow',
    cards: parallelAgentCards,
  },
  {
    eyebrow: 'Cloud workspace',
    title: 'Pick up the control plane anywhere. Keep execution local.',
    description:
      'The cloud syncs the backlog and project memory while your code, servers, worktrees, and previews stay on your machine.',
    accent: '#92d8bf',
    visual: 'cards',
    cards: cloudWorkspaceCards,
  },
  {
    eyebrow: 'Code practices',
    title: 'Agents should inherit your engineering standards.',
    description:
      'This visual slot is ready for a real platform screenshot. For now, the backlog screen keeps the story concrete and easy to replace.',
    accent: '#f5a3b7',
    visual: 'imageCards',
    cards: codePracticeCards,
  },
  {
    eyebrow: 'Specialist agents',
    title: 'One implementation path, sharpened by focused reviewers.',
    description:
      'The main agent writes the code. Specialists improve context, UI quality, verification, and risk assessment before you decide.',
    accent: '#d5c7ff',
    visual: 'agents',
  },
  {
    eyebrow: 'Project creation',
    title: 'From empty folder to agent-ready codebase.',
    description:
      'This chapter is reserved for a product screen later. The current screenshot keeps the premium visual moment in place.',
    accent: '#92d8bf',
    visual: 'build',
    cards: projectCreationCards,
  },
  {
    eyebrow: 'Bring it together',
    title: 'Give agents work. Keep engineering control.',
    description:
      'Run AI agents in isolated worktrees, preview their output, review every diff, and merge only when the work earns it.',
    accent: '#ffffff',
    visual: 'cta',
  },
] satisfies StoryScene[]

export function ScrollStory() {
  const sectionRef = useRef<HTMLElement>(null)
  const progress = useScrollProgress(sectionRef)
  const heroProgress = smoothstep(0.02, storyStartProgress, progress)
  const storyProgress = clamp(
    (progress - storyStartProgress) / (1 - storyStartProgress),
    0,
    1
  )
  const storyVisibility = smoothstep(0.78, 1, heroProgress)
  const metrics = useMemo(
    () =>
      sceneMetrics(storyProgress).map((metric) => ({
        ...metric,
        visibility: metric.visibility * storyVisibility,
      })),
    [storyProgress, storyVisibility]
  )

  return (
    <section
      id="top"
      aria-labelledby="hero-title"
      ref={sectionRef}
      className="hero-stage relative bg-[#050505]"
      style={{ height: `${totalScrollHeight}vh` }}
    >
      <span
        id="workflow"
        className="absolute"
        style={{ top: `${totalScrollHeight * storyStartProgress}vh` }}
      />
      <span id="download" className="absolute bottom-0" />
      <div className="fixed inset-0 isolate overflow-hidden">
        <HeroScene />
        <SceneWarmup />
        <StoryBackdrop heroProgress={heroProgress} progress={progress} />
        <HeroFrame progress={heroProgress} />
        <div style={storyInterfaceStyle(storyVisibility)}>
          <SceneProgress progress={storyProgress} />
          <SceneDots progress={storyProgress} sectionRef={sectionRef} />
        </div>
        {storyScenes.map((scene, index) => (
          <StorySceneFrame
            key={scene.title}
            scene={scene}
            metrics={metrics[index]}
          />
        ))}
      </div>
    </section>
  )
}

function HeroFrame({ progress }: { progress: number }) {
  return (
    <div
      className="absolute inset-0 z-10 mx-auto flex w-full max-w-9xl flex-col px-5 pb-0 pt-24 sm:px-8 lg:px-10"
      style={heroFrameStyle(progress)}
    >
      <div
        className="flex flex-1 items-center justify-center pb-4 pt-8 sm:pb-6 lg:pb-8"
        style={heroCopyStyle(progress)}
      >
        <div className="text-center">
          <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-white/14 bg-white/[0.07] px-3 py-1.5 text-xs font-medium uppercase text-white/76 shadow-2xl shadow-black/30 backdrop-blur-md">
            <span className="h-1.5 w-1.5 rounded-full bg-[#9fd7ff] shadow-[0_0_18px_rgba(159,215,255,0.9)]" />
            Agentic IDE
          </div>
          <h1
            id="hero-title"
            className="text-balance text-[clamp(3.4rem,10vw,9.5rem)] font-semibold leading-[0.9] text-white drop-shadow-[0_20px_70px_rgba(0,0,0,0.55)]"
          >
            The industrial-grade
            <br />
            agentic IDE.
          </h1>
          <p className="mx-auto mt-7 max-w-2xl text-balance text-base leading-7 text-white/76 sm:text-lg md:text-xl">
            Turn every request into an isolated worktree, with live preview,
            diffs, and controlled merge.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href="#download"
              className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-[#080808] shadow-[0_18px_60px_rgba(255,255,255,0.22)] transition duration-200 hover:-translate-y-0.5 hover:bg-[#dfe7ff] focus:outline-none focus:ring-2 focus:ring-white/60 focus:ring-offset-2 focus:ring-offset-[#050505]"
            >
              Request access
              <ArrowRight className="h-4 w-4 transition duration-200 group-hover:translate-x-0.5" />
            </a>
            <a
              href="#workflow"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/14 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-white/90 backdrop-blur-md transition duration-200 hover:-translate-y-0.5 hover:bg-white/[0.1] focus:outline-none focus:ring-2 focus:ring-white/45 focus:ring-offset-2 focus:ring-offset-[#050505]"
            >
              <Play className="h-4 w-4 fill-current" />
              See the workflow
            </a>
          </div>
        </div>
      </div>

      <HeroMockup progress={progress} />
    </div>
  )
}

function HeroMockup({ progress }: { progress: number }) {
  return (
    <div
      className="pointer-events-none z-20 mx-auto mb-4 w-full max-w-5xl"
      style={heroMockupStyle(progress)}
    >
      <div className="border border-white/16 bg-white/[0.08] p-2 shadow-[0_32px_120px_rgba(0,0,0,0.55)] backdrop-blur-2xl sm:p-3">
        <div className="overflow-hidden border border-white/10 bg-[#0a0a0a] shadow-inner">
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

function StorySceneFrame({
  scene,
  metrics,
}: {
  scene: StoryScene
  metrics: SceneMetrics
}) {
  return (
    <article
      aria-hidden={metrics.visibility < 0.05}
      className="absolute inset-0 flex items-center px-5 py-20 sm:px-8 lg:px-10"
      style={sceneFrameStyle(metrics)}
    >
      <div className="mx-auto grid w-full max-w-7xl gap-8 lg:grid-cols-[0.82fr_1.18fr] lg:items-center lg:gap-12">
        <StoryCopy scene={scene} progress={metrics.local} />
        <StoryVisual scene={scene} progress={metrics.local} />
      </div>
    </article>
  )
}

function StoryCopy({
  scene,
  progress,
}: {
  scene: StoryScene
  progress: number
}) {
  return (
    <div className="max-w-2xl">
      <p
        className="mb-5 text-xs font-semibold uppercase text-white/54"
        style={revealStyle(progress, -0.34)}
      >
        {scene.eyebrow}
      </p>
      <h2
        className="text-balance text-[clamp(2.4rem,6vw,5.9rem)] font-semibold leading-[0.95] text-white"
        style={revealStyle(progress, -0.28)}
      >
        {scene.title}
      </h2>
      <p
        className="mt-6 max-w-xl text-balance text-base leading-7 text-white/68 sm:text-lg"
        style={revealStyle(progress, -0.18)}
      >
        {scene.description}
      </p>
    </div>
  )
}

function StoryVisual({
  scene,
  progress,
}: {
  scene: StoryScene
  progress: number
}) {
  if (scene.visual === 'workflow')
    return <WorkflowVisual cards={scene.cards ?? []} progress={progress} />
  if (scene.visual === 'imageCards')
    return <ImageCardsVisual cards={scene.cards ?? []} progress={progress} />
  if (scene.visual === 'agents') return <AgentsVisual progress={progress} />
  if (scene.visual === 'build')
    return <BuildVisual cards={scene.cards ?? []} progress={progress} />
  if (scene.visual === 'cta') return <CtaVisual progress={progress} />
  return (
    <ProgressiveCards
      accent={scene.accent}
      cards={scene.cards ?? []}
      progress={progress}
    />
  )
}

function ProgressiveCards({
  accent,
  cards,
  progress,
}: {
  accent: string
  cards: readonly StoryCard[]
  progress: number
}) {
  return (
    <div className="relative min-h-[22rem] sm:min-h-[28rem] lg:min-h-[34rem]">
      {cards.map((card, index) => (
        <article
          key={card.title}
          className="absolute inset-x-0 top-0 border border-white/12 bg-white/[0.075] p-5 shadow-[0_26px_90px_rgba(0,0,0,0.38)] backdrop-blur-xl sm:p-6 lg:p-7"
          style={stackCardStyle(progress, index, cards.length)}
        >
          <div className="mb-8 flex items-center gap-3">
            <span
              className="h-2 w-2 rounded-full"
              style={{
                backgroundColor: accent,
                boxShadow: `0 0 22px ${accent}`,
              }}
            />
            <span className="h-px flex-1 bg-white/16" />
            <span className="font-mono text-xs uppercase text-white/36">
              {card.label ?? `0${index + 1}`}
            </span>
          </div>
          <h3 className="text-2xl font-semibold leading-tight text-white sm:text-3xl">
            {card.title}
          </h3>
          <p className="mt-4 max-w-xl text-sm leading-6 text-white/62 sm:text-base sm:leading-7">
            {card.description}
          </p>
        </article>
      ))}
    </div>
  )
}

function WorkflowVisual({
  cards,
  progress,
}: {
  cards: readonly StoryCard[]
  progress: number
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[0.82fr_1.18fr] lg:items-center">
      <div className="grid gap-3">
        {cards.map((card, index) => (
          <WorkflowStep
            key={card.title}
            card={card}
            index={index}
            progress={progress}
            total={cards.length}
          />
        ))}
      </div>
      <ScreenshotPanel progress={progress} tone="#9fd7ff" />
    </div>
  )
}

function WorkflowStep({
  card,
  index,
  progress,
  total,
}: {
  card: StoryCard
  index: number
  progress: number
  total: number
}) {
  const amount = staggerProgress(progress, index, total)

  return (
    <article
      className="border border-white/12 bg-white/[0.065] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl"
      style={slideRevealStyle(amount, index % 2 === 0 ? -18 : 18)}
    >
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center border border-white/14 bg-white/[0.075] font-mono text-xs text-white/76">
          {card.label}
        </span>
        <div>
          <h3 className="text-lg font-semibold leading-tight text-white">
            {card.title}
          </h3>
          <p className="mt-2 text-sm leading-6 text-white/58">
            {card.description}
          </p>
        </div>
      </div>
    </article>
  )
}

function ImageCardsVisual({
  cards,
  progress,
}: {
  cards: readonly StoryCard[]
  progress: number
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
      <ScreenshotPanel progress={progress} tone="#f5a3b7" />
      <CompactCardList cards={cards} progress={progress} />
    </div>
  )
}

function CompactCardList({
  cards,
  progress,
}: {
  cards: readonly StoryCard[]
  progress: number
}) {
  return (
    <div className="grid gap-3">
      {cards.map((card, index) => (
        <article
          key={card.title}
          className="border border-white/12 bg-[#0d0d0d]/80 p-4 backdrop-blur-xl"
          style={slideRevealStyle(
            staggerProgress(progress, index, cards.length),
            20
          )}
        >
          <p className="mb-3 font-mono text-xs uppercase text-white/36">
            {card.label}
          </p>
          <h3 className="text-lg font-semibold text-white">{card.title}</h3>
          <p className="mt-2 text-sm leading-6 text-white/58">
            {card.description}
          </p>
        </article>
      ))}
    </div>
  )
}

function ScreenshotPanel({
  progress,
  tone,
}: {
  progress: number
  tone: string
}) {
  return (
    <div
      className="border border-white/14 bg-white/[0.07] p-2 shadow-[0_30px_110px_rgba(0,0,0,0.48)] backdrop-blur-2xl"
      style={screenshotStyle(progress, tone)}
    >
      <div className="overflow-hidden border border-white/10 bg-[#0a0a0a]">
        <Image
          src="/desktop-backlog.png"
          alt="Blame desktop backlog interface"
          width={2450}
          height={1385}
          className="h-auto w-full"
        />
      </div>
    </div>
  )
}

function AgentsVisual({ progress }: { progress: number }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[0.78fr_1.22fr] lg:items-stretch">
      <MainAgentPanel progress={progress} />
      <div className="grid gap-3 sm:grid-cols-2">
        {specialistAgentCards.map((agent, index) => (
          <SpecialistCard
            key={agent.title}
            agent={agent}
            index={index}
            progress={progress}
          />
        ))}
      </div>
    </div>
  )
}

function MainAgentPanel({ progress }: { progress: number }) {
  return (
    <article
      className="flex min-h-72 flex-col justify-between border border-white/12 bg-white/[0.07] p-6 shadow-[0_26px_90px_rgba(0,0,0,0.36)] backdrop-blur-xl"
      style={slideRevealStyle(staggerProgress(progress, 0, 6), -22)}
    >
      <div>
        <span className="mb-6 grid h-10 w-10 place-items-center border border-white/14 bg-white/[0.08] text-white">
          <Sparkles className="h-5 w-5" />
        </span>
        <h3 className="text-3xl font-semibold leading-tight text-white">
          Implements the task.
        </h3>
        <p className="mt-4 text-sm leading-6 text-white/62">
          Edits the code, integrates specialist feedback, prepares the diff, and
          keeps work attached to the story.
        </p>
      </div>
      <p className="mt-8 flex items-center gap-3 text-sm font-semibold text-white/78">
        <GitPullRequestArrow className="h-4 w-4" />
        One controlled implementation path
      </p>
    </article>
  )
}

function SpecialistCard({
  agent,
  index,
  progress,
}: {
  agent: SpecialistAgent
  index: number
  progress: number
}) {
  const Icon = agent.icon

  return (
    <article
      className="border border-white/10 bg-[#0d0d0d]/82 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.24)] backdrop-blur-xl"
      style={slideRevealStyle(staggerProgress(progress, index + 1, 6), 22)}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <span
          className="grid h-9 w-9 place-items-center border border-white/12 bg-white/[0.065]"
          style={{ color: agent.color }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="font-mono text-xs text-white/32">0{index + 1}</span>
      </div>
      <h3 className="text-base font-semibold text-white">{agent.title}</h3>
      <p className="mt-2 text-sm leading-6 text-white/56">
        {agent.description}
      </p>
    </article>
  )
}

function BuildVisual({
  cards,
  progress,
}: {
  cards: readonly StoryCard[]
  progress: number
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[0.78fr_1.22fr] lg:items-center">
      <BuildSteps cards={cards} progress={progress} />
      <div className="relative">
        <ScreenshotPanel progress={progress} tone="#92d8bf" />
        <BuildBadge progress={progress} />
      </div>
    </div>
  )
}

function BuildSteps({
  cards,
  progress,
}: {
  cards: readonly StoryCard[]
  progress: number
}) {
  return (
    <div className="grid gap-3">
      {cards.map((card, index) => (
        <article
          key={card.title}
          className="border border-white/12 bg-white/[0.06] p-4 backdrop-blur-xl"
          style={slideRevealStyle(
            staggerProgress(progress, index, cards.length),
            -20
          )}
        >
          <p className="mb-3 flex items-center gap-2 font-mono text-xs text-white/38">
            <Boxes className="h-4 w-4" />
            {card.label}
          </p>
          <h3 className="text-lg font-semibold text-white">{card.title}</h3>
          <p className="mt-2 text-sm leading-6 text-white/58">
            {card.description}
          </p>
        </article>
      ))}
    </div>
  )
}

function BuildBadge({ progress }: { progress: number }) {
  return (
    <div
      className="absolute -bottom-5 left-5 right-5 border border-white/12 bg-[#101010]/90 p-4 shadow-[0_22px_80px_rgba(0,0,0,0.38)] backdrop-blur-xl sm:left-auto sm:w-72"
      style={slideRevealStyle(smoothstep(0.58, 0.9, progress), 18)}
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-white">
        <FileCode2 className="h-4 w-4 text-[#92d8bf]" />
        Reserved platform screen
      </p>
      <p className="mt-2 text-sm leading-5 text-white/56">
        Replace this reserved moment with the real platform screen later.
      </p>
    </div>
  )
}

function CtaVisual({ progress }: { progress: number }) {
  return (
    <div className="flex flex-col gap-3" style={revealStyle(progress, 0.1)}>
      <a
        href="#download"
        className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-[#080808] shadow-[0_18px_60px_rgba(255,255,255,0.2)] transition duration-200 hover:-translate-y-0.5 hover:bg-[#dfe7ff] focus:outline-none focus:ring-2 focus:ring-white/60 focus:ring-offset-2 focus:ring-offset-[#050505]"
      >
        Download Blame
        <ArrowRight className="h-4 w-4 transition duration-200 group-hover:translate-x-0.5" />
      </a>
      <a
        href="#top"
        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/14 bg-white/[0.07] px-5 py-3 text-sm font-semibold text-white/90 backdrop-blur-md transition duration-200 hover:-translate-y-0.5 hover:bg-white/[0.11] focus:outline-none focus:ring-2 focus:ring-white/45 focus:ring-offset-2 focus:ring-offset-[#050505]"
      >
        <Play className="h-4 w-4 fill-current" />
        Replay the story
      </a>
    </div>
  )
}

function StoryBackdrop({
  heroProgress,
  progress,
}: {
  heroProgress: number
  progress: number
}) {
  const glow = 0.1 + progress * 0.24
  const veil = 0.12 + heroProgress * 0.68
  const blur = heroProgress * 18

  return (
    <div className="absolute inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          backdropFilter: `blur(${blur}px)`,
          WebkitBackdropFilter: `blur(${blur}px)`,
        }}
      />
      <div
        className="absolute inset-0 bg-[#050505]"
        style={{ opacity: veil }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.08),transparent_28%,rgba(146,216,191,0.08)_52%,transparent_76%,rgba(247,207,131,0.08))]" />
      <div
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_10%,rgba(255,255,255,0.12),transparent_44%)]"
        style={{ opacity: glow }}
      />
      <div className="absolute inset-0 opacity-[0.12] [background-image:linear-gradient(rgba(255,255,255,0.16)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.16)_1px,transparent_1px)] [background-size:88px_88px]" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#050505] to-transparent" />
    </div>
  )
}

function SceneProgress({ progress }: { progress: number }) {
  return (
    <div className="pointer-events-none absolute inset-x-5 bottom-5 z-20 h-px bg-white/12 sm:inset-x-8 lg:inset-x-10">
      <div
        className="h-px bg-white shadow-[0_0_18px_rgba(255,255,255,0.7)]"
        style={{ transform: `scaleX(${progress})`, transformOrigin: 'left' }}
      />
    </div>
  )
}

function SceneDots({
  progress,
  sectionRef,
}: {
  progress: number
  sectionRef: RefObject<HTMLElement | null>
}) {
  return (
    <div className="absolute right-6 top-1/2 z-20 hidden -translate-y-1/2 flex-col gap-3 lg:flex">
      {storyScenes.map((scene, index) => (
        <button
          key={scene.eyebrow}
          aria-label={`Go to ${scene.eyebrow}`}
          className="h-2 w-2 rounded-full bg-white/28 transition duration-200 hover:bg-white"
          style={dotStyle(progress, index)}
          onClick={() => scrollToScene(sectionRef.current, index)}
          type="button"
        />
      ))}
    </div>
  )
}

function useScrollProgress(ref: RefObject<HTMLElement | null>) {
  const [progress, setProgress] = useState(0)
  const progressRef = useRef(0)
  const targetRef = useRef(0)

  useEffect(() => {
    let frame = 0
    let lastFrameTime = performance.now()
    const readProgress = () => {
      const node = ref.current
      if (!node) return targetRef.current
      const scrollable = node.offsetHeight - window.innerHeight
      if (scrollable <= 0) return 0
      return clamp(-node.getBoundingClientRect().top / scrollable, 0, 1)
    }
    const animate = (time: number) => {
      const delta = Math.min((time - lastFrameTime) / 1000, 0.05)
      const current = progressRef.current
      const target = targetRef.current
      const amount = 1 - Math.exp(-scrollProgressResponse * delta)
      const next =
        Math.abs(target - current) < 0.0005
          ? target
          : current + (target - current) * amount
      lastFrameTime = time
      progressRef.current = next
      setProgress(next)
      if (next === target) {
        frame = 0
        return
      }
      frame = window.requestAnimationFrame(animate)
    }
    const requestAnimation = () => {
      if (frame) return
      lastFrameTime = performance.now()
      frame = window.requestAnimationFrame(animate)
    }
    const updateTarget = () => {
      targetRef.current = readProgress()
      requestAnimation()
    }
    const initialProgress = readProgress()
    progressRef.current = initialProgress
    targetRef.current = initialProgress
    setProgress(initialProgress)
    window.addEventListener('scroll', updateTarget, { passive: true })
    window.addEventListener('resize', updateTarget)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', updateTarget)
      window.removeEventListener('resize', updateTarget)
    }
  }, [ref])

  return progress
}

function sceneMetrics(progress: number) {
  return storyScenes.map((_, index) => {
    const offset = progress * storyScenes.length - index
    const entering = smoothstep(-0.42, 0, offset)
    const exiting =
      index === storyScenes.length - 1 ? 1 : 1 - smoothstep(0.76, 1, offset)
    return {
      local: clamp(offset, 0, 1),
      offset,
      visibility: entering * exiting,
    }
  })
}

function heroFrameStyle(progress: number): CSSProperties {
  const opacity = 1 - smoothstep(0.72, 0.98, progress)

  return {
    opacity,
    pointerEvents: progress < 0.72 ? 'auto' : 'none',
  }
}

function heroCopyStyle(progress: number): CSSProperties {
  const amount = smoothstep(0.1, 0.68, progress)

  return {
    opacity: 1 - amount,
    transform: `translate3d(0, ${amount * -72}px, 0) scale(${1 - amount * 0.035})`,
  }
}

function heroMockupStyle(progress: number): CSSProperties {
  const lift = smoothstep(0.04, 0.9, progress)
  const fade = smoothstep(0.72, 1, progress)

  return {
    opacity: 1 - fade,
    transform: `translate3d(0, ${lift * -82}vh, 0) scale(${1 + lift * 0.42})`,
  }
}

function storyInterfaceStyle(visibility: number): CSSProperties {
  return {
    opacity: visibility,
    pointerEvents: visibility > 0.75 ? 'auto' : 'none',
  }
}

function sceneFrameStyle(metrics: SceneMetrics): CSSProperties {
  const visibility = easeOut(metrics.visibility)
  const y = (1 - visibility) * 22 * Math.sign(metrics.offset || 1)

  return {
    opacity: visibility,
    pointerEvents: visibility > 0.75 ? 'auto' : 'none',
    transform: `translate3d(0, ${y}px, 0) scale(${0.965 + visibility * 0.035})`,
  }
}

function stackCardStyle(progress: number, index: number, total: number) {
  const reveal = staggerProgress(progress, index, total)
  const exit = smoothstep(
    (index + 0.82) / total,
    (index + 1.2) / total,
    progress
  )
  const x = (1 - reveal) * 120 - exit * 42
  const y = index * 22 - exit * 18

  return {
    borderRadius: 8,
    opacity: reveal * (1 - exit * 0.28),
    transform: `translate3d(${x}px, ${y}px, 0) scale(${0.92 + reveal * 0.08 - exit * 0.04})`,
    zIndex: index + 1,
  } satisfies CSSProperties
}

function revealStyle(progress: number, start: number): CSSProperties {
  const amount = smoothstep(start, start + 0.22, progress)

  return {
    opacity: amount,
    transform: `translate3d(0, ${(1 - amount) * 18}px, 0)`,
  }
}

function slideRevealStyle(amount: number, x: number): CSSProperties {
  const eased = easeOut(amount)

  return {
    borderRadius: 8,
    opacity: eased,
    transform: `translate3d(${(1 - eased) * x}px, ${(1 - eased) * 12}px, 0)`,
  }
}

function screenshotStyle(progress: number, tone: string): CSSProperties {
  const amount = smoothstep(0.16, 0.72, progress)

  return {
    borderRadius: 8,
    boxShadow: `0 30px 110px rgba(0,0,0,0.48), 0 0 ${amount * 70}px ${tone}33`,
    opacity: amount,
    transform: `perspective(1200px) rotateX(${(1 - amount) * 8}deg) translate3d(0, ${(1 - amount) * 26}px, 0) scale(${0.94 + amount * 0.06})`,
  }
}

function dotStyle(progress: number, index: number): CSSProperties {
  const active = sceneMetrics(progress)[index].visibility

  return {
    opacity: 0.32 + active * 0.68,
    transform: `scale(${1 + active * 0.75})`,
  }
}

function staggerProgress(progress: number, index: number, total: number) {
  const start = index / (total + 0.8)
  return smoothstep(start, start + 0.34, progress)
}

function scrollToScene(node: HTMLElement | null, index: number) {
  if (!node) return
  const top = node.getBoundingClientRect().top + window.scrollY
  const scrollable = node.offsetHeight - window.innerHeight
  const sceneProgress = index / storyScenes.length
  window.scrollTo({
    behavior: 'smooth',
    top: top + scrollable * (storyStartProgress + sceneProgress * (1 - storyStartProgress)),
  })
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return x * x * (3 - 2 * x)
}

function easeOut(value: number) {
  return 1 - Math.pow(1 - clamp(value, 0, 1), 3)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
