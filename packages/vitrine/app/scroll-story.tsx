'use client'

import Image from 'next/image'
import {
  ArrowRight,
  Boxes,
  FileCode2,
  GitPullRequestArrow,
  Play,
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { HeroScene } from './scene/hero-scene'

type StoryCard = {
  title: string
  description: string
  label?: string
}

type SpecialistAgent = StoryCard & {
  image: string
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
  visibility: number
}

type SceneTimelineSegment = {
  start: number
  end: number
}

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
    image: '/agents/codebase-analyst.png',
    color: '#9fd7ff',
  },
  {
    title: 'Story Analyst',
    description:
      'Clarifies goals, acceptance criteria, constraints, and edge cases.',
    image: '/agents/story-analyst.png',
    color: '#f7cf83',
  },
  {
    title: 'Frontend Specialist',
    description:
      'Checks hierarchy, responsiveness, accessibility, and product polish.',
    image: '/agents/frontend-design-specialist.png',
    color: '#f5a3b7',
  },
  {
    title: 'Test Analyst',
    description:
      'Plans commands, proof points, behaviors, and regression coverage.',
    image: '/agents/test-verification-analyst.png',
    color: '#92d8bf',
  },
  {
    title: 'Risk Reviewer',
    description:
      'Looks for unsafe assumptions, data risks, and merge blockers.',
    image: '/agents/risk-review-analyst.png',
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

const heroScrollUnits = 1.1
const heroStoryOverlapUnits = 0.38
const viewportHeightPerUnit = 105
const sectionIntroScrollUnits = 0.7
const sectionItemScrollUnits = 0.24
const sectionOutroScrollUnits = 0.06
const sceneScrollWeights = storyScenes.map(sceneScrollWeight)
const sceneTimelineSegments = buildSceneTimeline(sceneScrollWeights)
const storyScrollUnits = sceneScrollWeights.reduce(
  (total, weight) => total + weight,
  0
)
const totalTimelineUnits =
  heroScrollUnits + storyScrollUnits - heroStoryOverlapUnits
const heroEndProgress = heroScrollUnits / totalTimelineUnits
const storyStartProgress =
  (heroScrollUnits - heroStoryOverlapUnits) / totalTimelineUnits
const totalScrollHeight = totalTimelineUnits * viewportHeightPerUnit
const sceneEnterShare = 0.1
const sceneExitStart = 0.98
const workflowAnchorLocalProgress = sceneEnterShare * 1.35
const workflowAnchorProgress = pageProgressForStoryLocal(
  0,
  workflowAnchorLocalProgress
)

export function ScrollStory() {
  const sectionRef = useRef<HTMLElement>(null)
  const progress = useScrollProgress(sectionRef)
  const heroProgress = timelineProgress(progress, 0, heroEndProgress)
  const storyProgress = timelineProgress(progress, storyStartProgress, 1)
  const storyVisibility = smoothstep(0.62, 0.86, heroProgress)
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
        style={{ top: `${totalScrollHeight * workflowAnchorProgress}vh` }}
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
          <h1
            id="hero-title"
            className="text-balance text-[clamp(3.4rem,10vw,9.5rem)] font-semibold leading-[0.9] tracking-tighter text-white drop-shadow-[0_20px_70px_rgba(0,0,0,0.55)] sm:leading-32"
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
              href="/download"
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
  );
}

function HeroMockup({ progress }: { progress: number }) {
  return (
    <div
      className="pointer-events-none z-20 mx-auto mb-4 w-full max-w-5xl"
      style={heroMockupStyle(progress)}
    >
      <div className="overflow-hidden rounded-2xl border border-white/16 bg-white/[0.08] p-2 shadow-[0_32px_120px_rgba(0,0,0,0.55)] backdrop-blur-2xl sm:p-3">
        <Image
          src="/desktop-backlog.png"
          alt="Blame backlog desktop interface"
          width={2450}
          height={1385}
          className="h-auto w-full rounded-xl"
          priority
        />
      </div>
    </div>
  );
}

function StorySceneFrame({
  scene,
  metrics,
}: {
  scene: StoryScene
  metrics: SceneMetrics
}) {
  if (scene.visual === 'cta')
    return <CtaSceneFrame scene={scene} metrics={metrics} />

  const contentActive =
    metrics.local >= sectionContentStartProgress(sceneRevealCount(scene))

  return (
    <article
      aria-hidden={metrics.visibility < 0.05}
      className="absolute inset-0 px-5 py-16 sm:px-8 sm:py-20 lg:px-10"
      style={sceneFrameStyle(metrics)}
    >
      <div className="relative mx-auto h-full w-full max-w-7xl">
        <StoryTitle scene={scene} progress={metrics.local} />
        <div
          className="absolute inset-x-0 bottom-8 top-[38vh] flex items-start sm:bottom-0 sm:top-[40vh] lg:top-[38vh] xl:top-[32vh] 2xl:top-[26vh]"
          style={sectionContentStyle(contentActive)}
        >
          <div className="mx-auto w-full max-w-5xl self-center">
            <StoryVisual
              scene={scene}
              active={contentActive}
              progress={metrics.local}
            />
          </div>
        </div>
      </div>
    </article>
  )
}

function CtaSceneFrame({
  scene,
  metrics,
}: {
  scene: StoryScene
  metrics: SceneMetrics
}) {
  const contentActive = metrics.local >= 0.36

  return (
    <article
      aria-hidden={metrics.visibility < 0.05}
      className="absolute inset-0 px-5 py-20 sm:px-8 lg:px-10"
      style={sceneFrameStyle(metrics)}
    >
      <div className="mx-auto flex h-full w-full max-w-7xl items-center justify-center">
        <div className="w-full text-center" style={ctaGroupStyle(metrics.local)}>
          <p className="mb-5 text-base font-semibold uppercase tracking-wide text-white/68 sm:text-lg">
            {scene.eyebrow}
          </p>
          <h2
            className="mx-auto max-w-6xl text-balance font-semibold leading-[0.9] tracking-tighter text-white sm:leading-[0.92]"
            style={ctaTitleStyle(metrics.local)}
          >
            Give agents work.
            <br />
            Keep engineering control.
          </h2>
          <p
            className="mx-auto mt-6 max-w-5xl text-balance text-xl leading-8 text-white/76 sm:text-2xl sm:leading-9"
            style={revealItemStyle(contentActive, 0, 18)}
          >
            {scene.description}
          </p>
          <div className="mt-8 flex justify-center">
            <CtaVisual active={contentActive} />
          </div>
        </div>
      </div>
    </article>
  )
}

function StoryTitle({
  scene,
  progress,
}: {
  scene: StoryScene
  progress: number
}) {
  return (
    <div
      className="absolute z-10 text-center"
      style={sceneTitleStyle(progress)}
    >
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/68 sm:mb-4 sm:text-sm lg:mb-5 lg:text-base">
        {scene.eyebrow}
      </p>
      <h2 className="text-balance text-[clamp(2.45rem,min(8.2vw,10.5vh),8.8rem)] font-semibold leading-[0.9] tracking-tighter text-white sm:leading-[0.92]">
        {scene.title}
      </h2>
      <p
        className="mx-auto mt-3 max-w-4xl text-balance text-sm leading-6 text-white/76 sm:mt-4 sm:text-lg sm:leading-7 lg:mt-5 lg:text-xl lg:leading-8"
        style={titleDescriptionStyle(progress)}
      >
        {scene.description}
      </p>
    </div>
  )
}

function StoryVisual({
  scene,
  active,
  progress,
}: {
  scene: StoryScene
  active: boolean
  progress: number
}) {
  if (scene.visual === 'workflow')
    return (
      <WorkflowVisual
        active={active}
        cards={scene.cards ?? []}
        progress={progress}
      />
    )
  if (scene.visual === 'imageCards')
    return (
      <ImageCardsVisual
        active={active}
        cards={scene.cards ?? []}
        progress={progress}
      />
    )
  if (scene.visual === 'agents')
    return <AgentsVisual active={active} progress={progress} />
  if (scene.visual === 'build')
    return (
      <BuildVisual
        active={active}
        cards={scene.cards ?? []}
        progress={progress}
      />
    )
  if (scene.visual === 'cta') return <CtaVisual active={active} />
  return (
    <ProgressiveCards
      accent={scene.accent}
      active={active}
      cards={scene.cards ?? []}
      progress={progress}
    />
  )
}

function ProgressiveCards({
  accent,
  active,
  cards,
  progress,
}: {
  accent: string
  active: boolean
  cards: readonly StoryCard[]
  progress: number
}) {
  return (
    <div className="relative min-h-[19rem] sm:min-h-[22rem] lg:min-h-[26rem] xl:min-h-[30rem]">
      {cards.map((card, index) => (
        <article
          key={card.title}
          className="absolute inset-x-0 top-0 overflow-hidden border border-white/14 bg-[#111316]/88 p-4 shadow-[0_28px_100px_rgba(0,0,0,0.48)] backdrop-blur-2xl supports-[backdrop-filter]:bg-[#111316]/76 sm:p-5 lg:p-6 xl:p-7"
          style={stackedCardStyle(
            active && itemTriggered(progress, index, cards.length),
            index
          )}
        >
          <div className="mb-5 flex items-center gap-3 sm:mb-6 lg:mb-8">
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
          <h3 className="text-xl font-semibold leading-tight text-white sm:text-2xl lg:text-3xl">
            {card.title}
          </h3>
          <p className="mt-3 max-w-xl text-sm leading-6 text-white/66 sm:mt-4 sm:text-base sm:leading-7">
            {card.description}
          </p>
        </article>
      ))}
    </div>
  )
}

function WorkflowVisual({
  active,
  cards,
  progress,
}: {
  active: boolean
  cards: readonly StoryCard[]
  progress: number
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[0.82fr_1.18fr] lg:items-center xl:gap-5">
      <div className="grid gap-2 sm:gap-3">
        {cards.map((card, index) => (
          <WorkflowStep
            key={card.title}
            active={active}
            card={card}
            index={index}
            progress={progress}
            total={cards.length + 1}
          />
        ))}
      </div>
      <div className="hidden sm:block">
        <ScreenshotPanel
          active={active && itemTriggered(progress, cards.length, cards.length + 1)}
          alt="Blame desktop preview interface"
          delay={0}
          src="/desktop-preview.png"
          tone="#9fd7ff"
        />
      </div>
    </div>
  )
}

function WorkflowStep({
  active,
  card,
  index,
  progress,
  total,
}: {
  active: boolean
  card: StoryCard
  index: number
  progress: number
  total: number
}) {
  return (
    <article
      className="border border-white/12 bg-white/[0.065] p-3 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:p-4"
      style={revealItemStyle(
        active && itemTriggered(progress, index, total),
        0,
        index % 2 === 0 ? -18 : 18
      )}
    >
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center border border-white/14 bg-white/[0.075] font-mono text-xs text-white/76">
          {card.label}
        </span>
        <div>
          <h3 className="text-lg font-semibold leading-tight text-white">
            {card.title}
          </h3>
          <p className="mt-1.5 text-sm leading-5 text-white/58 sm:mt-2 sm:leading-6">
            {card.description}
          </p>
        </div>
      </div>
    </article>
  )
}

function ImageCardsVisual({
  active,
  cards,
  progress,
}: {
  active: boolean
  cards: readonly StoryCard[]
  progress: number
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr] lg:items-center xl:gap-5">
      <div className="hidden sm:block">
        <ScreenshotPanel
          active={active && itemTriggered(progress, 0, cards.length + 1)}
          alt="Blame desktop code practices interface"
          delay={0}
          src="/desktop-practices.png"
          tone="#f5a3b7"
        />
      </div>
      <CompactCardList active={active} cards={cards} progress={progress} />
    </div>
  )
}

function CompactCardList({
  active,
  cards,
  progress,
}: {
  active: boolean
  cards: readonly StoryCard[]
  progress: number
}) {
  return (
    <div className="grid gap-2 sm:gap-3">
      {cards.map((card, index) => (
        <article
          key={card.title}
          className="border border-white/12 bg-[#0d0d0d]/80 p-3 backdrop-blur-xl sm:p-4"
          style={revealItemStyle(
            active && itemTriggered(progress, index + 1, cards.length + 1),
            0,
            20
          )}
        >
          <p className="mb-2 font-mono text-xs uppercase text-white/36 sm:mb-3">
            {card.label}
          </p>
          <h3 className="text-lg font-semibold text-white">{card.title}</h3>
          <p className="mt-1.5 text-sm leading-5 text-white/58 sm:mt-2 sm:leading-6">
            {card.description}
          </p>
        </article>
      ))}
    </div>
  )
}

function ScreenshotPanel({
  active,
  alt,
  delay,
  src,
  tone,
}: {
  active: boolean
  alt: string
  delay: number
  src: string
  tone: string
}) {
  return (
    <div
      className="overflow-hidden rounded-2xl border border-white/14 bg-white/[0.07] p-2 shadow-[0_30px_110px_rgba(0,0,0,0.48)] backdrop-blur-2xl"
      style={screenshotStyle(active, tone, delay)}
    >
      <Image
        src={src}
        alt={alt}
        width={2450}
        height={1385}
        className="h-auto max-h-[24vh] w-full rounded-xl object-contain sm:max-h-[30vh] lg:max-h-[38vh] xl:max-h-none"
      />
    </div>
  );
}

function AgentsVisual({
  active,
  progress,
}: {
  active: boolean
  progress: number
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-[0.78fr_1.22fr] lg:items-stretch xl:gap-4">
      <MainAgentPanel active={active && itemTriggered(progress, 0, 6)} />
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        {specialistAgentCards.map((agent, index) => (
          <SpecialistCard
            active={active && itemTriggered(progress, index + 1, 6)}
            key={agent.title}
            agent={agent}
            index={index}
          />
        ))}
      </div>
    </div>
  )
}

function MainAgentPanel({ active }: { active: boolean }) {
  return (
    <article
      className="flex min-h-40 flex-col justify-between border border-white/12 bg-white/[0.07] p-4 shadow-[0_26px_90px_rgba(0,0,0,0.36)] backdrop-blur-xl sm:min-h-56 sm:p-5 lg:min-h-64 lg:p-6"
      style={revealItemStyle(active, 0, -22)}
    >
      <div>
        <h3 className="text-xl font-semibold leading-tight text-white sm:text-2xl lg:text-3xl">
          Implements the task.
        </h3>
        <p className="mt-3 text-sm leading-5 text-white/62 sm:mt-4 sm:leading-6">
          Edits the code, integrates specialist feedback, prepares the diff, and
          keeps work attached to the story.
        </p>
      </div>
      <p className="mt-4 flex items-center gap-3 text-sm font-semibold text-white/78 lg:mt-8">
        <GitPullRequestArrow className="h-4 w-4" />
        One controlled implementation path
      </p>
    </article>
  )
}

function SpecialistCard({
  active,
  agent,
  index,
}: {
  active: boolean
  agent: SpecialistAgent
  index: number
}) {
  return (
    <article
      className="border border-white/10 bg-[#0d0d0d]/82 p-3 shadow-[0_18px_60px_rgba(0,0,0,0.24)] backdrop-blur-xl sm:p-4"
      style={revealItemStyle(active, 0, 22)}
    >
      <div className="mb-2 flex items-center justify-between gap-3 sm:mb-4">
        <span
          className="rounded-full border border-white/12 bg-white/[0.065] p-0.5 shadow-[0_0_24px_rgba(255,255,255,0.08)]"
          style={{
            boxShadow: `0 0 24px color-mix(in srgb, ${agent.color} 26%, transparent)`,
          }}
        >
          <Avatar className="size-8 sm:size-9">
            <AvatarImage src={agent.image} alt="" />
            <AvatarFallback aria-label={agent.title}>
              {agent.title
                .split(' ')
                .map((word) => word[0])
                .join('')}
            </AvatarFallback>
          </Avatar>
        </span>
        <span className="font-mono text-xs text-white/32">0{index + 1}</span>
      </div>
      <h3 className="text-sm font-semibold leading-tight text-white sm:text-base">
        {agent.title}
      </h3>
      <p className="mt-1.5 text-xs leading-4 text-white/56 sm:mt-2 sm:text-sm sm:leading-6">
        {agent.description}
      </p>
    </article>
  )
}

function BuildVisual({
  active,
  cards,
  progress,
}: {
  active: boolean
  cards: readonly StoryCard[]
  progress: number
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[0.78fr_1.22fr] lg:items-center xl:gap-5">
      <BuildSteps active={active} cards={cards} progress={progress} />
      <div className="relative hidden sm:block">
        <ScreenshotPanel
          active={active && itemTriggered(progress, cards.length, cards.length + 2)}
          alt="Blame desktop new project interface"
          delay={0}
          src="/desktop-new-project.png"
          tone="#92d8bf"
        />
        <BuildBadge
          active={
            active && itemTriggered(progress, cards.length + 1, cards.length + 2)
          }
        />
      </div>
    </div>
  )
}

function BuildSteps({
  active,
  cards,
  progress,
}: {
  active: boolean
  cards: readonly StoryCard[]
  progress: number
}) {
  return (
    <div className="grid gap-2 sm:gap-3">
      {cards.map((card, index) => (
        <article
          key={card.title}
          className="border border-white/12 bg-white/[0.06] p-3 backdrop-blur-xl sm:p-4"
          style={revealItemStyle(
            active && itemTriggered(progress, index, cards.length + 2),
            0,
            -20
          )}
        >
          <p className="mb-2 flex items-center gap-2 font-mono text-xs text-white/38 sm:mb-3">
            <Boxes className="h-4 w-4" />
            {card.label}
          </p>
          <h3 className="text-lg font-semibold text-white">{card.title}</h3>
          <p className="mt-1.5 text-sm leading-5 text-white/58 sm:mt-2 sm:leading-6">
            {card.description}
          </p>
        </article>
      ))}
    </div>
  )
}

function BuildBadge({ active }: { active: boolean }) {
  return (
    <div
      className="absolute -bottom-4 left-4 right-4 border border-white/12 bg-[#101010]/90 p-3 shadow-[0_22px_80px_rgba(0,0,0,0.38)] backdrop-blur-xl sm:-bottom-5 sm:left-auto sm:w-72 sm:p-4"
      style={revealItemStyle(active, 0, 18)}
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

function CtaVisual({ active }: { active: boolean }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 sm:flex-row sm:items-start"
      style={revealItemStyle(active, 0, 18)}
    >
      <a
        href="#top"
        className="inline-flex min-h-14 items-center justify-center gap-2.5 rounded-full border border-white/14 bg-white/[0.07] px-7 py-4 text-base font-semibold text-white/90 backdrop-blur-md transition duration-200 hover:-translate-y-0.5 hover:bg-white/[0.11] focus:outline-none focus:ring-2 focus:ring-white/45 focus:ring-offset-2 focus:ring-offset-[#050505]"
      >
        <Play className="h-5 w-5 fill-current" />
        Replay the story
      </a>
      <div className="flex flex-col items-center gap-2">
        <a
          href="/download"
          className="group inline-flex min-h-14 items-center justify-center gap-2.5 rounded-full bg-white px-7 py-4 text-base font-semibold text-[#080808] shadow-[0_18px_60px_rgba(255,255,255,0.2)] transition duration-200 hover:-translate-y-0.5 hover:bg-[#dfe7ff] focus:outline-none focus:ring-2 focus:ring-white/60 focus:ring-offset-2 focus:ring-offset-[#050505]"
        >
          Or write your own
          <ArrowRight className="h-5 w-5 transition duration-200 group-hover:translate-x-0.5" />
        </a>
        <p className="text-center text-xs font-light leading-5 text-white/56 sm:text-sm">
          Download Blame now.
        </p>
      </div>
    </div>
  );
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

function sceneScrollWeight(scene: StoryScene) {
  if (scene.visual === 'cta') return 1.08
  return sectionScrollWeight(sceneRevealCount(scene))
}

function sceneRevealCount(scene: StoryScene) {
  const cards = scene.cards?.length ?? 0

  if (scene.visual === 'agents') return 6
  if (scene.visual === 'workflow') return cards + 1
  if (scene.visual === 'imageCards') return cards + 1
  if (scene.visual === 'build') return cards + 2
  return Math.max(1, cards)
}

function sectionScrollWeight(total: number) {
  return (
    sectionIntroScrollUnits +
    Math.max(1, total) * sectionItemScrollUnits +
    sectionOutroScrollUnits
  )
}

function sectionContentStartProgress(total: number) {
  return sectionIntroScrollUnits / sectionScrollWeight(total)
}

function buildSceneTimeline(weights: readonly number[]) {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let cursor = 0

  return weights.map((weight) => {
    const start = cursor / total
    cursor += weight
    return { start, end: cursor / total } satisfies SceneTimelineSegment
  })
}

function sceneMetrics(progress: number) {
  return storyScenes.map((_, index) => {
    const segment = sceneTimelineSegments[index]
    const isLastScene = index === storyScenes.length - 1
    const start = segment?.start ?? 0
    const end = segment?.end ?? 1
    const local = timelineProgress(progress, start, end)

    return {
      local,
      visibility: sceneVisibility(local, isLastScene),
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
  const amount = easeOut(timelineProgress(progress, 0, 0.68))

  return {
    opacity: 1 - amount,
    transform: `translate3d(0, ${amount * -72}px, 0) scale(${1 - amount * 0.035})`,
  }
}

function heroMockupStyle(progress: number): CSSProperties {
  const lift = easeOut(timelineProgress(progress, 0, 0.9))
  const fade = smoothstep(0.34, 0.72, progress)

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

  return {
    opacity: visibility,
    pointerEvents: visibility > 0.75 ? 'auto' : 'none',
    transform: `translate3d(0, ${(1 - visibility) * 18}px, 0) scale(${0.985 + visibility * 0.015})`,
  }
}

function sceneTitleStyle(progress: number): CSSProperties {
  const compact = smoothstep(0.12, 0.46, progress)
  const opacity = smoothstep(0, 0.08, progress)

  return {
    left: '50%',
    maxWidth: 'calc(100vw - 2.5rem)',
    opacity,
    top: `${lerp(50, 8, compact)}%`,
    transform: `translate3d(-50%, ${lerp(-50, 0, compact)}%, 0) scale(${lerp(1, 0.62, compact)})`,
    transformOrigin: 'top center',
    width: `${lerp(92, 84, compact)}rem`,
  }
}

function ctaTitleStyle(progress: number): CSSProperties {
  const compact = smoothstep(0.12, 0.42, progress)

  return {
    fontSize: `clamp(${lerp(3.8, 3.04, compact).toFixed(2)}rem, ${lerp(9, 7.2, compact).toFixed(2)}vw, ${lerp(9.5, 7.6, compact).toFixed(2)}rem)`,
  }
}

function ctaGroupStyle(progress: number): CSSProperties {
  const amount = smoothstep(0, 0.18, progress)

  return {
    opacity: amount,
    transform: `translate3d(0, ${(1 - amount) * 18}px, 0) scale(${0.97 + amount * 0.03})`,
  }
}

function titleDescriptionStyle(progress: number): CSSProperties {
  const amount = smoothstep(0.38, 0.58, progress)

  return {
    opacity: amount,
    transform: `translate3d(0, ${(1 - amount) * 10}px, 0)`,
  }
}

function sectionContentStyle(active: boolean): CSSProperties {
  return {
    opacity: active ? 1 : 0,
    pointerEvents: active ? 'auto' : 'none',
    transform: active
      ? 'translate3d(0, 0, 0)'
      : 'translate3d(0, 22px, 0)',
    transition: revealTransition(0, 520),
  }
}

function stackedCardStyle(active: boolean, index: number) {
  const y = index * 24
  const scale = 1 - index * 0.012
  const visibleTransform = `translate3d(${index * 4}px, ${y}px, 0) scale(${scale})`
  const hiddenTransform = `translate3d(96px, ${y + 20}px, 0) scale(0.94)`

  return {
    borderRadius: 8,
    opacity: active ? 1 : 0,
    transform: active ? visibleTransform : hiddenTransform,
    transition: revealTransition(0, 740),
    zIndex: index + 1,
  } satisfies CSSProperties
}

function revealItemStyle(
  active: boolean,
  delay: number,
  x: number
): CSSProperties {
  return {
    borderRadius: 8,
    opacity: active ? 1 : 0,
    transform: active ? 'translate3d(0, 0, 0)' : `translate3d(${x}px, 16px, 0)`,
    transition: revealTransition(delay, 620),
  }
}

function screenshotStyle(
  active: boolean,
  tone: string,
  delay: number
): CSSProperties {
  return {
    boxShadow: active
      ? `0 30px 110px rgba(0,0,0,0.48), 0 0 70px ${tone}33`
      : '0 30px 110px rgba(0,0,0,0.42), 0 0 0 transparent',
    opacity: active ? 1 : 0,
    transform: active
      ? 'perspective(1200px) rotateX(0deg) translate3d(0, 0, 0) scale(1)'
      : 'perspective(1200px) rotateX(8deg) translate3d(0, 26px, 0) scale(0.94)',
    transition: revealTransition(delay, 720),
  }
}

function dotStyle(progress: number, index: number): CSSProperties {
  const active = sceneMetrics(progress)[index].visibility

  return {
    opacity: 0.32 + active * 0.68,
    transform: `scale(${1 + active * 0.75})`,
  }
}

function itemTriggered(progress: number, index: number, total: number) {
  const count = Math.max(1, total)
  const step = clamp(index, 0, count - 1)
  const trigger =
    (sectionIntroScrollUnits + step * sectionItemScrollUnits) /
    sectionScrollWeight(count)

  return progress >= trigger
}

function pageProgressForStoryLocal(index: number, local: number) {
  const segment = sceneTimelineSegments[index] ?? { start: 0, end: 1 }
  const sceneProgress =
    segment.start + (segment.end - segment.start) * clamp(local, 0, 1)
  return storyStartProgress + sceneProgress * (1 - storyStartProgress)
}

function scrollToScene(node: HTMLElement | null, index: number) {
  if (!node) return
  const top = node.getBoundingClientRect().top + window.scrollY
  const scrollable = node.offsetHeight - window.innerHeight
  window.scrollTo({
    behavior: 'smooth',
    top:
      top +
      scrollable * pageProgressForStoryLocal(index, workflowAnchorLocalProgress),
  })
}

function timelineProgress(progress: number, start: number, end: number) {
  if (end <= start) return 1
  return clamp((progress - start) / (end - start), 0, 1)
}

function sceneVisibility(local: number, isLastScene: boolean) {
  const enter = smoothstep(0, sceneEnterShare, local)
  const exit = isLastScene ? 1 : 1 - smoothstep(sceneExitStart, 1, local)
  return enter * exit
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return x * x * (3 - 2 * x)
}

function easeOut(value: number) {
  return 1 - Math.pow(1 - clamp(value, 0, 1), 3)
}

function revealTransition(delay: number, duration: number) {
  return `opacity ${duration}ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms, transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms, box-shadow ${duration}ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms`
}

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * amount
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
