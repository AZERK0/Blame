"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState, type UIEvent } from "react";
import { ScrollReveal } from "@/components/scroll-reveal";

type HighlightTone = "amber" | "blue" | "lavender" | "night" | "photo";

type Highlight = {
  alt: string;
  description: string;
  eyebrow: string;
  image: string;
  title: string;
  tone: HighlightTone;
};

const highlights: Highlight[] = [
  {
    eyebrow: "The workflow",
    title: "Every request. One clear lane.",
    description: "From brief to merge, the whole workflow stays visible.",
    image: "/desktop-backlog.png",
    alt: "Blame backlog and development workflow",
    tone: "night",
  },
  {
    eyebrow: "Isolated by default",
    title: "One story. Its own workspace.",
    description: "A dedicated worktree, environment, port, and local runtime.",
    image: "/home-illustrations/1.jpg",
    alt: "",
    tone: "photo",
  },
  {
    eyebrow: "Live preview",
    title: "See it run. Keep the final say.",
    description:
      "Preview locally. Review every change. Merge when it earns it.",
    image: "/desktop-preview.png",
    alt: "Blame live preview and review interface",
    tone: "blue",
  },
  {
    eyebrow: "Code practices",
    title: "Your standards, built in.",
    description: "Match the codebase or apply a stricter engineering standard.",
    image: "/desktop-practices.png",
    alt: "Blame code practices interface",
    tone: "lavender",
  },
  {
    eyebrow: "Project creation",
    title: "Start ready.",
    description: "Choose a web stack. Blame prepares it for agent work.",
    image: "/desktop-new-project.png",
    alt: "Blame guided project creation interface",
    tone: "amber",
  },
];

const toneStyles: Record<HighlightTone, string> = {
  amber: "bg-[#edc991] text-[#171109]",
  blue: "bg-[radial-gradient(circle_at_72%_80%,#253468,#0b1020_58%)] text-white",
  lavender: "bg-[#eef0ff] text-[#11131a]",
  night: "bg-black text-white",
  photo: "bg-[#090b0f] text-white",
};

export function HighlightsCarousel() {
  const railRef = useRef<HTMLUListElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

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
        <HighlightRail railRef={railRef} onScroll={handleScroll} />
        <HighlightDots
          activeIndex={activeIndex}
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
  onScroll,
  railRef,
}: {
  onScroll: (event: UIEvent<HTMLUListElement>) => void;
  railRef: React.RefObject<HTMLUListElement | null>;
}) {
  return (
    <ul
      ref={railRef}
      tabIndex={0}
      aria-label="Blame highlights"
      onScroll={onScroll}
      className="highlights-rail flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-5 pb-2 sm:gap-5 sm:px-8 lg:px-[max(2.5rem,calc((100vw-80rem)/2))]"
    >
      {highlights.map((highlight) => (
        <HighlightCard key={highlight.title} highlight={highlight} />
      ))}
    </ul>
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
          className={
            highlight.tone === "amber" || highlight.tone === "lavender"
              ? "text-sm font-semibold text-[#3545ad] sm:text-base"
              : "text-sm font-semibold text-[#9aa7ff] sm:text-base"
          }
        >
          {highlight.eyebrow}
        </p>
        <h3 className="mt-3 text-balance text-[clamp(1.75rem,2.5vw,2.25rem)] font-semibold leading-[1.08] tracking-[-0.025em]">
          {highlight.title}
        </h3>
        <p className="mt-4 max-w-xl text-base font-medium leading-6 opacity-60 sm:text-lg sm:leading-7">
          {highlight.description}
        </p>
      </div>
    </li>
  );
}

function HighlightVisual({ highlight }: { highlight: Highlight }) {
  if (highlight.tone === "photo") {
    return (
      <>
        <Image
          src={highlight.image}
          alt={highlight.alt}
          fill
          sizes="(max-width: 768px) 86vw, 1105px"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,5,8,0.84)_0%,rgba(4,5,8,0.18)_55%,rgba(4,5,8,0.74)_100%)]" />
      </>
    );
  }

  return (
    <div className="absolute inset-x-[6%] bottom-0 h-[61%] sm:h-[64%]">
      <Image
        src={highlight.image}
        alt={highlight.alt}
        fill
        sizes="(max-width: 768px) 80vw, 980px"
        className="object-contain object-bottom drop-shadow-[0_30px_70px_rgba(0,0,0,0.32)]"
      />
    </div>
  );
}

function HighlightDots({
  activeIndex,
  scrollToIndex,
}: {
  activeIndex: number;
  scrollToIndex: (index: number) => void;
}) {
  return (
    <div className="mt-8 flex justify-center">
      <div className="flex items-center gap-2 rounded-full bg-black/35 p-3">
        {highlights.map((highlight, index) => (
          <button
            key={highlight.title}
            type="button"
            aria-label={`Show highlight ${index + 1}`}
            aria-current={activeIndex === index ? "true" : undefined}
            onClick={() => scrollToIndex(index)}
            className={`h-2 rounded-full transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-white/50 ${activeIndex === index ? "w-8 bg-white" : "w-2 bg-white/45 hover:bg-white/70"}`}
          />
        ))}
      </div>
    </div>
  );
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
