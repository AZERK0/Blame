"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type UIEvent,
} from "react";
import {
  projectCreationAccentClassName,
  projectCreationPanelClassName,
} from "@/components/project-creation-theme";
import {
  parallelAgentProviders,
  ProviderLogo,
} from "@/components/provider-logos";
import { ScrollReveal } from "@/components/scroll-reveal";

type HighlightTone = "blue" | "lavender" | "night" | "photo" | "teal";

type HighlightBase = {
  description: string;
  emphasizeWorkspace?: boolean;
  eyebrow: string;
  title: string;
  tone: HighlightTone;
};

type Highlight = HighlightBase &
  (
    | {
        alt: string;
        image: string;
        imageHeight: number;
        imageWidth: number;
        visual?: "image";
      }
    | { visual: "providers" }
  );

const highlights: Highlight[] = [
  {
    eyebrow: "The workflow",
    title: "Every request. One clear lane.",
    description: "From brief to merge, the whole workflow stays visible.",
    image: "/desktop-backlog.png",
    imageHeight: 1385,
    imageWidth: 2450,
    alt: "Blame backlog and development workflow",
    tone: "night",
  },
  {
    eyebrow: "Isolated by default",
    title: "One story. Its own smart workspace.",
    emphasizeWorkspace: true,
    description: "A dedicated worktree, environment, port, and local runtime.",
    image: "/home-illustrations/1.jpg",
    imageHeight: 5304,
    imageWidth: 7952,
    alt: "",
    tone: "photo",
  },
  {
    eyebrow: "Live preview",
    title: "See each isolated worktree in action.",
    description:
      "Preview locally. Review every change. Merge when it earns it.",
    image: "/desktop-preview.png",
    imageHeight: 1385,
    imageWidth: 2258,
    alt: "Blame live preview and review interface",
    tone: "blue",
  },
  {
    eyebrow: "Parallel agents",
    title: "Every agent. The right model.",
    description: "Run multiple agents in parallel across 50 AI providers.",
    visual: "providers",
    tone: "night",
  },
  {
    eyebrow: "Code practices",
    title: "Your standards, built in.",
    description: "Match the codebase or apply a stricter engineering standard.",
    image: "/desktop-practices.png",
    imageHeight: 1385,
    imageWidth: 2258,
    alt: "Blame code practices interface",
    tone: "lavender",
  },
  {
    eyebrow: "Project creation",
    title: "Start ready.",
    description: "Choose a web stack. Blame prepares it for agent work.",
    image: "/desktop-new-project.png",
    imageHeight: 1385,
    imageWidth: 2258,
    alt: "Blame guided project creation interface",
    tone: "teal",
  },
];

const highlightDurationMs = 6500;
const highlightDragThreshold = 48;

type HighlightDrag = {
  currentX: number;
  pointerId: number;
  startIndex: number;
  startScrollLeft: number;
  startX: number;
};

const toneStyles: Record<HighlightTone, string> = {
  blue: "bg-[radial-gradient(circle_at_72%_80%,#253468,#0b1020_58%)] text-white",
  lavender: "bg-[#eef0ff] text-[#11131a]",
  night: "bg-black text-white",
  photo: "bg-[#090b0f] text-white",
  teal: projectCreationPanelClassName,
};

const toneEyebrowStyles: Record<HighlightTone, string> = {
  blue: "text-[#9aa7ff]",
  lavender: "text-[#3545ad]",
  night: "text-[#9aa7ff]",
  photo: "text-[#9aa7ff]",
  teal: projectCreationAccentClassName,
};

const toneImageAuraStyles: Record<HighlightTone, string> = {
  blue: "ring-1 ring-white/20 shadow-[0_0_100px_rgba(116,143,255,0.34),0_40px_110px_rgba(0,0,0,0.38)]",
  lavender:
    "ring-1 ring-[#3545ad]/20 shadow-[0_0_96px_rgba(53,69,173,0.26),0_40px_105px_rgba(35,38,80,0.2)]",
  night:
    "ring-1 ring-white/20 shadow-[0_0_110px_rgba(154,167,255,0.34),0_40px_110px_rgba(0,0,0,0.42)]",
  photo: "",
  teal: "ring-1 ring-white/20 shadow-[0_0_105px_rgba(159,224,202,0.34),0_40px_110px_rgba(2,20,20,0.42)]",
};

export function HighlightsCarousel() {
  const railRef = useRef<HTMLUListElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const isCarouselVisible = useHighlightVisibility(railRef);

  const scrollToIndex = (index: number) => {
    const rail = railRef.current;
    const card = rail?.children.item(index) as HTMLElement | null;
    if (!rail || !card) return;
    const centeredLeft =
      card.offsetLeft - (rail.clientWidth - card.offsetWidth) / 2;
    rail.scrollTo({ left: centeredLeft, behavior: "smooth" });
    setActiveIndex(index);
  };

  const move = (direction: -1 | 1) => {
    scrollToIndex(
      Math.max(0, Math.min(highlights.length - 1, activeIndex + direction)),
    );
  };

  const handleScroll = (event: UIEvent<HTMLUListElement>) => {
    setActiveIndex(findClosestCard(event.currentTarget));
  };

  return (
    <section
      aria-labelledby="highlights-title"
      className="overflow-hidden bg-[#1d1d1f] py-24 sm:py-32 lg:py-40"
    >
      <HighlightsHeader activeIndex={activeIndex} move={move} />
      <ScrollReveal delay={90} className="mt-12 sm:mt-16">
        <HighlightRail
          isDragging={isDragging}
          railRef={railRef}
          onScroll={handleScroll}
          scrollToIndex={scrollToIndex}
          setIsDragging={setIsDragging}
        />
        <HighlightDots
          activeIndex={activeIndex}
          isPaused={!isCarouselVisible || isDragging}
          scrollToIndex={scrollToIndex}
        />
      </ScrollReveal>
    </section>
  );
}

function HighlightsHeader({
  activeIndex,
  move,
}: {
  activeIndex: number;
  move: (direction: -1 | 1) => void;
}) {
  return (
    <ScrollReveal className="mx-auto flex max-w-7xl items-end justify-between gap-6 px-5 sm:px-8 lg:px-10">
      <h2
        id="highlights-title"
        className="text-[clamp(1.75rem,4.4vw,3.5rem)] font-semibold leading-[1.07] tracking-[-0.005em] text-[#f5f5f7]"
      >
        Highlights.
      </h2>
      <div className="flex gap-2">
        <CarouselButton
          direction="previous"
          disabled={activeIndex === 0}
          onClick={() => move(-1)}
        />
        <CarouselButton
          direction="next"
          disabled={activeIndex === highlights.length - 1}
          onClick={() => move(1)}
        />
      </div>
    </ScrollReveal>
  );
}

function CarouselButton({
  direction,
  disabled,
  onClick,
}: {
  direction: "next" | "previous";
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = direction === "next" ? ChevronRight : ChevronLeft;
  return (
    <button
      type="button"
      aria-label={
        direction === "next" ? "Next highlight" : "Previous highlight"
      }
      disabled={disabled}
      onClick={onClick}
      className="grid size-11 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/16 focus:outline-none focus:ring-2 focus:ring-white/50 disabled:cursor-default disabled:opacity-30 sm:size-12"
    >
      <Icon className="size-5" />
    </button>
  );
}

function HighlightRail({
  isDragging,
  onScroll,
  railRef,
  scrollToIndex,
  setIsDragging,
}: {
  isDragging: boolean;
  onScroll: (event: UIEvent<HTMLUListElement>) => void;
  railRef: React.RefObject<HTMLUListElement | null>;
  scrollToIndex: (index: number) => void;
  setIsDragging: (isDragging: boolean) => void;
}) {
  const dragHandlers = useHighlightDrag(setIsDragging, scrollToIndex);

  return (
    <ul
      ref={railRef}
      tabIndex={0}
      aria-label="Blame highlights"
      onScroll={onScroll}
      onDragStart={(event) => event.preventDefault()}
      onLostPointerCapture={dragHandlers.finish}
      onPointerCancel={dragHandlers.finish}
      onPointerDown={dragHandlers.start}
      onPointerMove={dragHandlers.move}
      onPointerUp={dragHandlers.end}
      className={`highlights-rail flex cursor-grab select-none gap-4 overflow-x-auto px-5 pb-2 active:cursor-grabbing sm:gap-5 sm:px-8 lg:px-[max(2.5rem,calc((100vw-80rem)/2))] ${isDragging ? "snap-none scroll-auto" : "snap-x snap-mandatory scroll-smooth"}`}
      style={{ touchAction: "pan-y" }}
    >
      {highlights.map((highlight) => (
        <HighlightCard key={highlight.title} highlight={highlight} />
      ))}
    </ul>
  );
}

function useHighlightDrag(
  setIsDragging: (isDragging: boolean) => void,
  scrollToIndex: (index: number) => void,
) {
  const dragRef = useRef<HighlightDrag | null>(null);
  const finish = () =>
    finishHighlightDrag(dragRef, setIsDragging, scrollToIndex);

  return {
    end: (event: ReactPointerEvent<HTMLUListElement>) =>
      endHighlightDrag(event, dragRef, finish),
    finish,
    move: (event: ReactPointerEvent<HTMLUListElement>) =>
      moveHighlightDrag(event, dragRef),
    start: (event: ReactPointerEvent<HTMLUListElement>) =>
      startHighlightDrag(event, dragRef, setIsDragging),
  };
}

function startHighlightDrag(
  event: ReactPointerEvent<HTMLUListElement>,
  dragRef: React.RefObject<HighlightDrag | null>,
  setIsDragging: (isDragging: boolean) => void,
) {
  if (!event.isPrimary || event.button !== 0) return;
  const rail = event.currentTarget;
  dragRef.current = {
    currentX: event.clientX,
    pointerId: event.pointerId,
    startIndex: findClosestCard(rail),
    startScrollLeft: rail.scrollLeft,
    startX: event.clientX,
  };
  rail.setPointerCapture(event.pointerId);
  setIsDragging(true);
}

function moveHighlightDrag(
  event: ReactPointerEvent<HTMLUListElement>,
  dragRef: React.RefObject<HighlightDrag | null>,
) {
  const drag = dragRef.current;
  if (!drag || drag.pointerId !== event.pointerId) return;
  event.preventDefault();
  drag.currentX = event.clientX;
  event.currentTarget.scrollLeft =
    drag.startScrollLeft + drag.startX - event.clientX;
}

function endHighlightDrag(
  event: ReactPointerEvent<HTMLUListElement>,
  dragRef: React.RefObject<HighlightDrag | null>,
  finish: () => void,
) {
  if (dragRef.current?.pointerId !== event.pointerId) return;
  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
  finish();
}

function finishHighlightDrag(
  dragRef: React.RefObject<HighlightDrag | null>,
  setIsDragging: (isDragging: boolean) => void,
  scrollToIndex: (index: number) => void,
) {
  const drag = dragRef.current;
  if (!drag) return;
  dragRef.current = null;
  setIsDragging(false);
  scrollToIndex(highlightDragTargetIndex(drag));
}

function highlightDragTargetIndex(drag: HighlightDrag) {
  const distance = drag.startX - drag.currentX;
  if (Math.abs(distance) < highlightDragThreshold) return drag.startIndex;
  const direction = distance > 0 ? 1 : -1;
  return Math.min(
    Math.max(drag.startIndex + direction, 0),
    highlights.length - 1,
  );
}

function HighlightCard({ highlight }: { highlight: Highlight }) {
  return (
    <li
      className={`relative h-[560px] w-[86vw] max-w-[1105px] shrink-0 snap-center overflow-hidden rounded-[1.75rem] sm:h-[620px] sm:rounded-[2rem] lg:h-[680px] ${toneStyles[highlight.tone]}`}
    >
      <HighlightVisual highlight={highlight} />
      <div className="relative z-10 max-w-2xl p-7 sm:p-10 lg:p-12">
        <p
          className={`text-sm font-semibold sm:text-base ${toneEyebrowStyles[highlight.tone]}`}
        >
          {highlight.eyebrow}
        </p>
        <h3 className="mt-3 text-balance text-[clamp(1.75rem,2.5vw,2.25rem)] font-semibold leading-[1.08] tracking-[-0.025em]">
          {highlight.emphasizeWorkspace ? (
            <>
              One story. Its own{" "}
              <span className="workspace-smart-sweep">
                <strong className="font-bold">smart</strong> workspace.
              </span>
            </>
          ) : (
            highlight.title
          )}
        </h3>
        <p className="mt-4 max-w-xl text-base font-medium leading-6 opacity-60 sm:text-lg sm:leading-7">
          {highlight.description}
        </p>
      </div>
    </li>
  );
}

function HighlightVisual({ highlight }: { highlight: Highlight }) {
  if (highlight.visual === "providers") {
    return <ProviderHighlightVisual />;
  }

  if (highlight.tone === "photo") {
    return (
      <div className="absolute inset-0 overflow-hidden rounded-xl">
        <Image
          src={highlight.image}
          alt={highlight.alt}
          width={highlight.imageWidth}
          height={highlight.imageHeight}
          sizes="(max-width: 768px) 86vw, 1105px"
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,5,8,0.84)_0%,rgba(4,5,8,0.18)_55%,rgba(4,5,8,0.74)_100%)]" />
      </div>
    );
  }

  return (
    <div className="absolute inset-x-[6%] bottom-0 flex h-[61%] items-end justify-center sm:h-[64%]">
      <Image
        src={highlight.image}
        alt={highlight.alt}
        width={highlight.imageWidth}
        height={highlight.imageHeight}
        sizes="(max-width: 768px) 80vw, 980px"
        className={`h-auto max-h-full w-auto max-w-full rounded-xl object-contain ${toneImageAuraStyles[highlight.tone]}`}
      />
    </div>
  );
}

function ProviderHighlightVisual() {
  return (
    <div
      className="absolute inset-x-[8%] bottom-8 flex h-[52%] flex-col justify-center sm:bottom-10"
      data-highlight-visual="providers"
    >
      <ul
        aria-label="Supported AI providers"
        className="grid grid-cols-3 gap-x-10 gap-y-10 sm:gap-x-20 sm:gap-y-12"
      >
        {parallelAgentProviders.map((provider) => (
          <li key={provider.name} className="flex justify-center">
            <ProviderLogo
              provider={provider}
              className="size-12 text-white sm:size-14 lg:size-16"
            />
          </li>
        ))}
      </ul>
      <p className="mt-8 text-center text-sm font-medium text-white/46 sm:mt-10 sm:text-base">
        + any OpenAI-compatible API
      </p>
    </div>
  );
}

function HighlightDots({
  activeIndex,
  isPaused,
  scrollToIndex,
}: {
  activeIndex: number;
  isPaused: boolean;
  scrollToIndex: (index: number) => void;
}) {
  const showNextHighlight = () => {
    scrollToIndex((activeIndex + 1) % highlights.length);
  };

  return (
    <div className="mt-8 flex justify-center">
      <div className="flex items-center gap-2 rounded-full bg-black/35 p-3">
        {highlights.map((highlight, index) => (
          <HighlightDot
            key={highlight.title}
            index={index}
            isActive={activeIndex === index}
            isPaused={isPaused}
            onComplete={showNextHighlight}
            scrollToIndex={scrollToIndex}
          />
        ))}
      </div>
      <HighlightProgressStyles />
    </div>
  );
}

function HighlightDot({
  index,
  isActive,
  isPaused,
  onComplete,
  scrollToIndex,
}: {
  index: number;
  isActive: boolean;
  isPaused: boolean;
  onComplete: () => void;
  scrollToIndex: (index: number) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Show highlight ${index + 1}`}
      aria-current={isActive ? "true" : undefined}
      onClick={() => scrollToIndex(index)}
      className={`relative h-2 overflow-hidden rounded-full transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-white/50 ${isActive ? "w-8 bg-white/25" : "w-2 bg-white/45 hover:bg-white/70"}`}
    >
      {isActive && (
        <HighlightProgress isPaused={isPaused} onComplete={onComplete} />
      )}
    </button>
  );
}

function HighlightProgress({
  isPaused,
  onComplete,
}: {
  isPaused: boolean;
  onComplete: () => void;
}) {
  return (
    <span
      aria-hidden="true"
      onAnimationEnd={onComplete}
      className="highlight-progress absolute inset-y-0 left-0 rounded-full bg-white"
      style={{
        animationDuration: `${highlightDurationMs}ms`,
        animationPlayState: isPaused ? "paused" : "running",
      }}
    />
  );
}

function HighlightProgressStyles() {
  return (
    <style>{`
        .highlight-progress {
          animation-name: fill-highlight-progress;
          animation-timing-function: linear;
          animation-fill-mode: forwards;
          width: 0;
          will-change: width;
        }

        @keyframes fill-highlight-progress {
          to {
            width: 100%;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .highlight-progress {
            animation: none;
            width: 100%;
          }
        }
      `}</style>
  );
}

function useHighlightVisibility(ref: React.RefObject<HTMLUListElement | null>) {
  const [isVisible, setIsVisible] = useState(false);
  useEffect(() => observeHighlightVisibility(ref.current, setIsVisible), [ref]);
  return isVisible;
}

function observeHighlightVisibility(
  element: HTMLUListElement | null,
  setIsVisible: (isVisible: boolean) => void,
) {
  if (!element || typeof IntersectionObserver === "undefined") {
    setIsVisible(true);
    return;
  }
  const observer = new IntersectionObserver(
    ([entry]) =>
      setIsVisible(
        Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.5),
      ),
    { threshold: [0, 0.5] },
  );
  observer.observe(element);
  return () => observer.disconnect();
}

function findClosestCard(rail: HTMLUListElement) {
  const railCenter = rail.scrollLeft + rail.clientWidth / 2;
  return Array.from(rail.children).reduce((closestIndex, child, index) => {
    const card = child as HTMLElement;
    const closest = rail.children.item(closestIndex) as HTMLElement;
    const cardDistance = Math.abs(
      card.offsetLeft + card.offsetWidth / 2 - railCenter,
    );
    const closestDistance = Math.abs(
      closest.offsetLeft + closest.offsetWidth / 2 - railCenter,
    );
    return cardDistance < closestDistance ? index : closestIndex;
  }, 0);
}
