import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import {
  ArrowRight,
  Check,
  Cloud,
  FileDiff,
  GitBranch,
  GitMerge,
  Laptop,
  MonitorPlay,
  Sparkles,
  Workflow,
} from "lucide-react";
import { HighlightsCarousel } from "@/components/highlights-carousel";
import { PipelineBacklogMockup } from "@/components/blame-mockups/backlog-mockup";
import { LivePreviewMockup } from "@/components/blame-mockups/preview-mockup";
import { ProjectCreationMockup } from "@/components/blame-mockups/project-creation-mockup";
import {
  projectCreationAccentClassName,
  projectCreationPanelClassName,
} from "@/components/project-creation-theme";
import { ScrollReveal } from "@/components/scroll-reveal";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { FinalCtaScene } from "./scene/final-cta-scene";

const workspaceSignals = [
  { title: "Worktree ready", icon: GitBranch },
  { title: "Environment synced", icon: Check },
  { title: "Preview attached", icon: MonitorPlay },
];

const specialistAgents = [
  {
    title: "Codebase Analyst",
    description: "Finds the right context.",
    image: "/agents/codebase-analyst.png",
    tone: "oklch(0.78 0.16 195)",
    glow: "oklch(0.72 0.19 195 / 28%)",
  },
  {
    title: "Story Analyst",
    description: "Tightens the brief.",
    image: "/agents/story-analyst.png",
    tone: "oklch(0.72 0.22 300)",
    glow: "oklch(0.67 0.23 300 / 28%)",
  },
  {
    title: "Frontend Design Specialist",
    description: "Refines the interface.",
    image: "/agents/frontend-design-specialist.png",
    tone: "oklch(0.75 0.23 350)",
    glow: "oklch(0.7 0.24 350 / 28%)",
  },
  {
    title: "Test & Verification Analyst",
    description: "Plans the proof.",
    image: "/agents/test-verification-analyst.png",
    tone: "oklch(0.76 0.2 145)",
    glow: "oklch(0.7 0.2 145 / 28%)",
  },
  {
    title: "Risk & Review Analyst",
    description: "Challenges merge readiness.",
    image: "/agents/risk-review-analyst.png",
    tone: "oklch(0.78 0.19 55)",
    glow: "oklch(0.72 0.2 55 / 28%)",
  },
];

const syncedItems = [
  "Backlog",
  "Story context",
  "Code practices",
  "Workspace state",
];

const localItems = ["Worktrees", "Commands", "Live previews", "Diffs"];

const reviewActions = [
  { label: "Review the evidence", icon: FileDiff },
  { label: "Request another pass", icon: Workflow },
  { label: "Approve and merge", icon: GitMerge },
];

export function ProductStory() {
  return (
    <div className="relative z-10 -mt-[48vh] bg-[#1d1d1f]">
      <StoryOpening />
      <HighlightsCarousel />
      <WorkflowSection />
      <WorkspaceSection />
      <PreviewSection />
      <PracticesSection />
      <SpecialistsSection />
      <LocalExecutionSection />
      <ProjectCreationSection />
      <FinalCtaSection />
    </div>
  );
}

function StoryOpening() {
  return (
    <section className="flex min-h-[100svh] items-center bg-[#050505] px-5 py-24 sm:px-8 sm:py-32 lg:px-10 lg:py-40">
      <div className="mx-auto w-full max-w-7xl">
        <ScrollReveal>
          <p className="story-eyebrow">Beyond the prompt</p>
        </ScrollReveal>
        <ScrollReveal delay={90} distance={36}>
          <h2 className="mt-7 max-w-5xl text-balance text-[clamp(3rem,7vw,7rem)] font-semibold leading-[0.95] tracking-[-0.045em] text-white">
            AI can write the code.{" "}
            <span className="text-[#86868b]">Blame makes it shippable.</span>
          </h2>
        </ScrollReveal>
        <ScrollReveal delay={180}>
          <p className="story-copy mt-9 max-w-3xl text-balance">
            Turn an idea into a user story, give it an isolated workspace, see
            it run, review every change, then decide what ships.
          </p>
        </ScrollReveal>
      </div>
    </section>
  );
}

function WorkflowSection() {
  return (
    <section
      id="workflow"
      aria-labelledby="workflow-title"
      className="scroll-mt-24 border-t-[24px] border-[#1d1d1f] bg-black px-5 py-32 sm:border-t-[32px] sm:px-8 sm:py-40 lg:border-t-[48px] lg:px-10 lg:py-48"
    >
      <div className="mx-auto max-w-7xl">
        <WorkflowHeading />
        <ScrollReveal delay={110} className="mt-20 sm:mt-28">
          <PipelineBacklogMockup />
        </ScrollReveal>
        <ScrollReveal delay={160}>
          <p className="story-copy mx-auto mt-12 max-w-4xl text-center sm:mt-16">
            Write the outcome once and Blame turns it into a durable lane for
            the entire development cycle. The brief, relevant context, agent
            activity, implementation state, review notes, and final decision
            stay attached to the same story, from the first backlog draft to the
            merge you approve.
          </p>
        </ScrollReveal>
      </div>
    </section>
  );
}

function WorkflowHeading() {
  return (
    <ScrollReveal className="text-center">
      <div>
        <p className="story-eyebrow">The backlog</p>
        <h2 id="workflow-title" className="story-title mx-auto mt-5 max-w-5xl">
          Every request gets a lane.
        </h2>
      </div>
    </ScrollReveal>
  );
}

function WorkspaceSection() {
  return (
    <section className="bg-[#1d1d1f] px-3 py-24 sm:px-6 sm:py-32 lg:px-8 lg:py-40">
      <ScrollReveal className="mx-auto max-w-[1480px]" distance={0}>
        <div
          className="user-story-state-effect rounded-[2rem] sm:rounded-[3rem]"
          data-story-state="in-progress"
        >
          <div className="relative z-[1] min-h-[680px] overflow-hidden rounded-[2rem] border border-white/10 sm:min-h-[760px] sm:rounded-[3rem]">
            <WorkspacePhoto />
            <div className="absolute inset-x-0 bottom-0 z-10 p-8 sm:p-14 lg:p-20">
              <p className="story-eyebrow">Isolated by default</p>
              <h2 className="mt-5 max-w-5xl text-balance text-[clamp(2.75rem,5.8vw,5.5rem)] font-semibold leading-[0.96] tracking-[-0.04em] text-white">
                One story. Its own{" "}
                <span className="workspace-smart-sweep">
                  <strong className="font-bold">smart</strong> workspace.
                </span>
              </h2>
              <p className="mt-8 max-w-3xl text-[1.0625rem] font-medium leading-7 text-white/68 sm:text-[1.3125rem] sm:leading-8">
                Blame automatically analyzes your project, determines what the
                story needs, and prepares a dedicated branch, worktree,
                environment, port, and local runtime before implementation
                starts.
              </p>
              <WorkspaceSignals />
            </div>
          </div>
        </div>
      </ScrollReveal>
    </section>
  );
}

function WorkspacePhoto() {
  return (
    <>
      <Image
        src="/home-illustrations/1.jpg"
        alt=""
        fill
        sizes="(max-width: 768px) 100vw, 1480px"
        className="object-cover grayscale-[0.25]"
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,5,5,0.68)_0%,rgba(5,5,5,0.12)_24%,rgba(5,5,5,0.2)_42%,rgba(5,5,5,0.96)_100%)]" />
    </>
  );
}

function WorkspaceSignals() {
  return (
    <ul className="mt-12 grid max-w-3xl gap-px overflow-hidden rounded-2xl border border-white/14 bg-white/14 sm:grid-cols-3">
      {workspaceSignals.map(({ icon: Icon, title }) => (
        <li
          key={title}
          className="flex items-center gap-3 bg-[#090b0f]/78 px-5 py-4 text-sm font-semibold text-white/78 backdrop-blur-xl"
        >
          <Icon className="h-4 w-4 text-[#9fd7ff]" />
          {title}
        </li>
      ))}
    </ul>
  );
}

function PreviewSection() {
  return (
    <section className="overflow-hidden border-t-[24px] border-[#1d1d1f] bg-[linear-gradient(180deg,#000_0%,#000_76%,#101012_100%)] px-5 py-32 sm:border-t-[32px] sm:px-8 sm:py-40 lg:border-t-[48px] lg:px-10 lg:py-48">
      <div className="mx-auto max-w-7xl">
        <PreviewHeading />
        <ScrollReveal delay={120} className="mt-20 sm:mt-28">
          <LivePreviewMockup />
        </ScrollReveal>
        <ReviewStory />
      </div>
    </section>
  );
}

function PreviewHeading() {
  return (
    <ScrollReveal className="text-center">
      <p className="story-eyebrow">Live preview</p>
      <h2 className="story-title mx-auto mt-5 max-w-6xl">
        See each isolated worktree in action.
      </h2>
      <p className="story-copy mx-auto mt-7 max-w-3xl">
        Open the running app beside the story. Inspect files, terminal output,
        and every change without chasing branches, ports, or browser tabs.
      </p>
    </ScrollReveal>
  );
}

function ReviewStory() {
  return (
    <div className="mt-24 grid gap-16 border-t border-white/12 pt-16 sm:mt-32 lg:grid-cols-[1fr_0.85fr] lg:gap-24 lg:pt-20">
      <ScrollReveal>
        <p className="story-eyebrow">Human decision</p>
        <h3 className="mt-5 max-w-2xl text-balance text-[clamp(2.25rem,4.2vw,4rem)] font-semibold leading-[0.98] tracking-[-0.035em]">
          Your call, all the way to merge.
        </h3>
      </ScrollReveal>
      <ScrollReveal delay={100}>
        <p className="story-copy">
          Request changes, reject the work, or approve and merge when it earns
          it. The agent moves fast. The decision stays yours.
        </p>
        <ReviewActions />
      </ScrollReveal>
    </div>
  );
}

function ReviewActions() {
  return (
    <ul className="mt-10 divide-y divide-white/10 border-y border-white/10">
      {reviewActions.map(({ icon: Icon, label }) => (
        <li key={label} className="flex items-center gap-4 py-4">
          <Icon className="h-5 w-5 text-white/42" />
          <span className="font-semibold text-white/78">{label}</span>
        </li>
      ))}
    </ul>
  );
}

function PracticesSection() {
  return (
    <section className="bg-[#1d1d1f] px-3 py-24 sm:px-6 sm:py-32 lg:px-8 lg:py-40">
      <ScrollReveal className="mx-auto max-w-[1480px]" distance={0}>
        <div className="overflow-hidden rounded-[2rem] bg-[#eef0ff] text-[#11131a] ring-1 ring-black/[0.04] sm:rounded-[3rem]">
          <div className="grid gap-16 p-8 sm:p-14 lg:grid-cols-[0.72fr_1.28fr] lg:items-end lg:p-20 xl:p-24">
            <PracticesCopy />
            <PracticesImage />
          </div>
        </div>
      </ScrollReveal>
    </section>
  );
}

function PracticesCopy() {
  return (
    <div className="lg:pb-6">
      <p className="text-[clamp(1.0625rem,1.7vw,1.5rem)] font-semibold leading-[1.2] text-[#3545ad]">
        Code practices
      </p>
      <h2 className="mt-5 text-balance text-[clamp(2.5rem,4.8vw,4.75rem)] font-semibold leading-[0.97] tracking-[-0.04em]">
        Your standards become the default.
      </h2>
      <p className="mt-8 max-w-xl text-[1.0625rem] font-medium leading-7 text-[#11131a]/62 sm:text-[1.3125rem] sm:leading-8">
        Match the repository&apos;s habits or apply a stricter standard for
        code, tests, architecture, and commits.
      </p>
      <p className="mt-12 text-lg font-semibold leading-7 text-[#3d3b78] sm:text-xl sm:leading-8">
        Generated by AI. Still shaped like your codebase.
      </p>
    </div>
  );
}

function PracticesImage() {
  return (
    <div className="relative lg:translate-x-8 xl:translate-x-12">
      <div className="mb-4 flex flex-wrap gap-2">
        <span className="rounded-full bg-[#11131a] px-4 py-2 text-xs font-semibold text-white">
          Match codebase
        </span>
        <span className="rounded-full border border-[#11131a]/18 px-4 py-2 text-xs font-semibold">
          Pro standard
        </span>
      </div>
      <div className="overflow-hidden rounded-2xl bg-[#11131a] p-2 shadow-[0_35px_100px_rgba(42,40,91,0.28)] sm:p-3">
        <Image
          src="/desktop-practices.png"
          alt="Blame code practices interface"
          width={2258}
          height={1385}
          className="h-auto w-full rounded-xl"
        />
      </div>
    </div>
  );
}

function SpecialistsSection() {
  return (
    <section className="border-y-[24px] border-[#1d1d1f] bg-black px-5 py-32 sm:border-y-[32px] sm:px-8 sm:py-40 lg:border-y-[48px] lg:px-10 lg:py-48">
      <div className="mx-auto max-w-7xl">
        <SpecialistsHeading />
        <AgentRail />
      </div>
    </section>
  );
}

function SpecialistsHeading() {
  return (
    <div className="grid gap-12 lg:grid-cols-[1fr_0.65fr] lg:items-end">
      <ScrollReveal>
        <p className="story-eyebrow">Specialist agents</p>
        <h2 className="story-title mt-5 max-w-5xl">
          More perspective. Only when it matters.
        </h2>
      </ScrollReveal>
      <ScrollReveal delay={100}>
        <p className="story-copy max-w-xl lg:pb-2">
          Focused specialists sharpen context, interface quality, verification,
          and risk. One lead agent stays responsible for the implementation.
        </p>
      </ScrollReveal>
    </div>
  );
}

function AgentRail() {
  return (
    <div className="mt-20 grid gap-4 sm:grid-cols-2 lg:mt-28 lg:grid-cols-5">
      {specialistAgents.map((agent, index) => (
        <ScrollReveal key={agent.title} delay={index * 70}>
          <article
            className="specialist-card group flex min-h-64 flex-col justify-between rounded-3xl border border-white/10 bg-white/[0.045] p-5 transition duration-300 hover:-translate-y-1 hover:bg-white/[0.075] sm:min-h-72 sm:p-6"
            style={specialistCardStyle(agent)}
          >
            <AgentPortrait agent={agent} />
            <div>
              <h3 className="text-lg font-semibold leading-tight text-white">
                {agent.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-white/48">
                {agent.description}
              </p>
            </div>
          </article>
        </ScrollReveal>
      ))}
    </div>
  );
}

function AgentPortrait({
  agent,
}: {
  agent: (typeof specialistAgents)[number];
}) {
  return (
    <Avatar className="size-18">
      <AvatarImage src={agent.image} alt="" />
      <AvatarFallback aria-label={agent.title}>A</AvatarFallback>
    </Avatar>
  );
}

function specialistCardStyle(agent: (typeof specialistAgents)[number]) {
  return {
    "--agent-response-color": agent.tone,
    "--agent-response-glow-color": agent.glow,
  } as CSSProperties;
}

function LocalExecutionSection() {
  return (
    <section className="bg-[linear-gradient(180deg,#050505_0%,#101012_100%)] px-5 py-32 sm:px-8 sm:py-40 lg:px-10 lg:py-48">
      <div className="mx-auto max-w-7xl">
        <ScrollReveal className="text-center">
          <p className="story-eyebrow">Local execution</p>
          <h2 className="story-title mx-auto mt-5 max-w-6xl">
            The cloud coordinates. Your machine executes.
          </h2>
        </ScrollReveal>
        <ExecutionDiagram />
        <ScrollReveal delay={180}>
          <p className="mx-auto mt-12 max-w-2xl text-center text-sm leading-6 text-white/38">
            Connect the AI provider you choose. Provider usage remains separate.
          </p>
        </ScrollReveal>
      </div>
    </section>
  );
}

function ExecutionDiagram() {
  return (
    <div className="mt-20 grid overflow-hidden rounded-[2rem] border border-white/12 bg-white/[0.025] lg:mt-28 lg:grid-cols-2">
      <ExecutionColumn
        icon={Cloud}
        items={syncedItems}
        label="Synced"
        title="A shared control plane."
      />
      <ExecutionColumn
        icon={Laptop}
        items={localItems}
        label="Local"
        title="A workspace you control."
      />
    </div>
  );
}

function ExecutionColumn({
  icon: Icon,
  items,
  label,
  title,
}: {
  icon: typeof Cloud;
  items: readonly string[];
  label: string;
  title: string;
}) {
  return (
    <ScrollReveal className="h-full">
      <div className="h-full border-b border-white/10 p-8 last:border-0 sm:p-12 lg:border-b-0 lg:border-r lg:p-16 lg:last:border-r-0">
        <Icon className="h-7 w-7 text-[#9fd7ff]" />
        <p className="mt-12 font-mono text-xs uppercase tracking-[0.18em] text-white/32">
          {label}
        </p>
        <h3 className="mt-4 text-[clamp(1.75rem,3vw,2.75rem)] font-semibold leading-[1.05] tracking-[-0.035em] text-white">
          {title}
        </h3>
        <ul className="mt-12 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-white/10 pt-8">
          {items.map((item) => (
            <li key={item} className="text-sm font-medium text-white/52">
              {item}
            </li>
          ))}
        </ul>
      </div>
    </ScrollReveal>
  );
}

function ProjectCreationSection() {
  return (
    <section className="bg-[#1d1d1f] px-3 py-24 sm:px-6 sm:py-32 lg:px-8 lg:py-40">
      <ScrollReveal className="mx-auto max-w-[1480px]" distance={0}>
        <div
          className={`overflow-hidden rounded-[2rem] ring-1 ring-white/[0.08] sm:rounded-[3rem] ${projectCreationPanelClassName}`}
        >
          <div className="grid gap-16 p-8 sm:p-14 lg:grid-cols-[0.68fr_1.32fr] lg:items-center lg:p-20 xl:p-24">
            <ProjectCreationCopy />
            <ProjectCreationImage />
          </div>
        </div>
      </ScrollReveal>
    </section>
  );
}

function ProjectCreationCopy() {
  return (
    <div>
      <p
        className={`text-[clamp(1.0625rem,1.7vw,1.5rem)] font-semibold leading-[1.2] ${projectCreationAccentClassName}`}
      >
        Project creation
      </p>
      <h2 className="mt-5 text-balance text-[clamp(3rem,5.8vw,5.75rem)] font-semibold leading-[0.95] tracking-[-0.04em]">
        Start ready.
      </h2>
      <p className="mt-8 max-w-lg text-[1.0625rem] font-medium leading-7 text-white/62 sm:text-[1.3125rem] sm:leading-8">
        Choose a web stack. Blame generates the structure, tooling, environment
        files, and preview configuration inside the same workflow.
      </p>
      <div className="mt-12 flex items-center gap-3 text-sm font-semibold">
        <Sparkles className="h-5 w-5" />
        From empty folder to agent-ready.
      </div>
    </div>
  );
}

function ProjectCreationImage() {
  return (
    <div className="overflow-hidden rounded-2xl bg-[#090b0f] p-2 shadow-[0_35px_100px_rgba(4,25,26,0.55)] sm:p-3 lg:translate-x-8 xl:translate-x-12">
      <ProjectCreationMockup />
    </div>
  );
}

function FinalCtaSection() {
  return (
    <section className="relative isolate flex min-h-[100svh] items-center overflow-hidden border-t-[24px] border-[#1d1d1f] bg-black px-5 py-32 sm:border-t-[32px] sm:px-8 sm:py-40 lg:border-t-[48px] lg:px-10">
      <FinalCtaBackdrop />
      <ScrollReveal className="relative z-10 mx-auto w-full max-w-7xl text-center">
        <p className="story-eyebrow">Blame early access</p>
        <h2 className="mx-auto mt-6 max-w-5xl text-balance text-[clamp(3rem,7vw,7rem)] font-semibold leading-[0.95] tracking-[-0.045em] text-white">
          Let agents move fast. Keep the final say.
        </h2>
        <p className="story-copy mx-auto mt-10 max-w-2xl text-white/62">
          Available for macOS, Windows, and Linux. Bring the AI provider you
          already use.
        </p>
        <FinalCtaActions />
      </ScrollReveal>
    </section>
  );
}

function FinalCtaBackdrop() {
  return (
    <div className="absolute inset-0 -z-10 overflow-hidden bg-black">
      <FinalCtaScene />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_48%,rgba(0,0,0,0.16)_0%,rgba(0,0,0,0.42)_52%,#050505_92%),linear-gradient(180deg,#050505_0%,rgba(5,5,5,0.3)_34%,rgba(5,5,5,0.72)_100%)]" />
    </div>
  );
}

function FinalCtaActions() {
  return (
    <div className="mt-12 flex flex-col items-center justify-center gap-3 sm:flex-row">
      <Link
        href="/download"
        className="group inline-flex min-h-14 items-center justify-center gap-2.5 rounded-full bg-white px-7 py-4 text-base font-semibold text-[#080808] shadow-[0_18px_60px_rgba(255,255,255,0.2)] transition duration-200 hover:-translate-y-0.5 hover:bg-[#dfe7ff] focus:outline-none focus:ring-2 focus:ring-white/60 focus:ring-offset-2 focus:ring-offset-[#050505]"
      >
        Download Blame
        <ArrowRight className="h-5 w-5 transition duration-200 group-hover:translate-x-0.5" />
      </Link>
      <Link
        href="/pricing"
        className="inline-flex min-h-14 items-center justify-center rounded-full border border-white/14 bg-white/[0.07] px-7 py-4 text-base font-semibold text-white/90 backdrop-blur-md transition duration-200 hover:-translate-y-0.5 hover:bg-white/[0.11] focus:outline-none focus:ring-2 focus:ring-white/45 focus:ring-offset-2 focus:ring-offset-[#050505]"
      >
        View pricing
      </Link>
    </div>
  );
}
