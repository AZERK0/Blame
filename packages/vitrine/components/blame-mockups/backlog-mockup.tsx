"use client";

import {
  type CSSProperties,
  type FocusEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import type { LucideIcon } from "lucide-react";
import {
  Check,
  CircleStop,
  ExternalLink,
  FilePlus2,
  FileText,
  FolderOpen,
  GitMerge,
  PictureInPicture2,
  Play,
  Plus,
  RotateCcw,
  Send,
  Terminal,
  Trash2,
  X,
} from "lucide-react";

import { BlameAppShell } from "./app-shell";
import {
  backlogColumns,
  heroBacklogStories,
  nextPipelineStatus,
  pipelineBacklogStories,
  storyStatusLabel,
  type BacklogColumnId,
  type MockStory,
} from "./backlog-data";
import styles from "./backlog-mockup.module.css";

type StoryActionId =
  | "approve"
  | "dequeue"
  | "diff"
  | "discard"
  | "files"
  | "preview"
  | "resume"
  | "rework"
  | "send"
  | "stop"
  | "terminal"
  | "trash"
  | "worktree"
  | "use-context"
  | "reject";

type StoryActionConfig = {
  icon: LucideIcon;
  label: string;
  tone?: "destructive" | "preview" | "success";
  iconOnly?: boolean;
};

const actionConfig: Record<StoryActionId, StoryActionConfig> = {
  approve: { icon: Check, label: "Approve & Merge", tone: "success" },
  dequeue: { icon: RotateCcw, label: "Dequeue", tone: "destructive" },
  diff: { icon: GitMerge, label: "Diff" },
  discard: { icon: X, label: "Discard", tone: "destructive", iconOnly: true },
  files: { icon: FileText, label: "Files" },
  preview: { icon: ExternalLink, label: "Open Preview", tone: "preview" },
  reject: { icon: X, label: "Reject", tone: "destructive" },
  resume: { icon: Play, label: "Resume Agent", tone: "success" },
  rework: { icon: RotateCcw, label: "Rework", tone: "success" },
  send: { icon: Send, label: "Send to Dev Agent", tone: "success" },
  stop: { icon: CircleStop, label: "Stop Agent", tone: "destructive" },
  terminal: { icon: Terminal, label: "Terminal" },
  trash: { icon: Trash2, label: "Delete", tone: "destructive", iconOnly: true },
  "use-context": { icon: FilePlus2, label: "Use Context", tone: "success" },
  worktree: { icon: FolderOpen, label: "Open Worktree" },
};

export function HeroBacklogMockup() {
  const backlog = useHeroBacklog();
  return (
    <div className={styles.mockupFrame}>
      <BlameAppShell>
        <BacklogBoard
          stories={backlog.stories}
          selectedStoryId={backlog.selectedStoryId}
          onAction={backlog.runAction}
          onCreateStory={backlog.createStory}
          onSelectStory={backlog.setSelectedStoryId}
          onTogglePip={backlog.togglePip}
          pipActive={backlog.pipActive}
        />
      </BlameAppShell>
    </div>
  );
}

export function PipelineBacklogMockup() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const visible = useIntersectionVisible(rootRef);
  const documentVisible = useDocumentVisible();
  const reducedMotion = useReducedMotion();
  const stories = usePipelineStories(
    hovered || focused || !visible || !documentVisible || reducedMotion,
  );

  return (
    <div
      ref={rootRef}
      className={styles.mockupFrame}
      onBlurCapture={(event) => setFocused(focusStayedInside(event))}
      onFocusCapture={() => setFocused(true)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <BlameAppShell>
        <BacklogBoard stories={stories} pipeline />
      </BlameAppShell>
    </div>
  );
}

export function StaticBacklogMockup({
  className,
}: {
  className?: string;
} = {}) {
  return (
    <BlameAppShell ariaHidden className={className} interactive={false}>
      <BacklogBoard stories={heroBacklogStories} />
    </BlameAppShell>
  );
}

function BacklogBoard(props: BacklogBoardProps) {
  return (
    <div className={styles.backlogPage}>
      <BacklogToolbar
        onCreateStory={props.onCreateStory}
        onTogglePip={props.onTogglePip}
        pipActive={props.pipActive ?? false}
        storyCount={props.stories.length}
      />
      <div className={styles.boardViewport}>
        <BoardLanes {...props} />
      </div>
    </div>
  );
}

type BacklogBoardProps = {
  stories: ReadonlyArray<MockStory>;
  onAction?: (storyId: string, action: StoryActionId) => void;
  onCreateStory?: () => void;
  onSelectStory?: (storyId: string) => void;
  onTogglePip?: () => void;
  pipeline?: boolean;
  pipActive?: boolean;
  selectedStoryId?: string;
};

function BoardLanes(props: BacklogBoardProps) {
  return (
    <div
      className={styles.boardGrid}
      data-pipeline={props.pipeline || undefined}
    >
      {backlogColumns.map((column) => (
        <BacklogLane
          key={column.id}
          column={column}
          stories={props.stories}
          showStories={!props.pipeline}
          selectedStoryId={props.selectedStoryId}
          onAction={props.onAction}
          onCreateStory={props.onCreateStory}
          onSelectStory={props.onSelectStory}
        />
      ))}
      {props.pipeline ? (
        <MovingPipelineStories stories={props.stories} />
      ) : null}
    </div>
  );
}

function BacklogToolbar({
  onCreateStory,
  onTogglePip,
  pipActive,
  storyCount,
}: BacklogToolbarProps) {
  return (
    <div className={styles.backlogToolbar}>
      <div>
        <h2>Backlog</h2>
        <p>{storyCount} user stories across the delivery pipeline</p>
      </div>
      <BacklogToolbarActions
        onCreateStory={onCreateStory}
        onTogglePip={onTogglePip}
        pipActive={pipActive}
      />
    </div>
  );
}

type BacklogToolbarProps = {
  onCreateStory?: () => void;
  onTogglePip?: () => void;
  pipActive: boolean;
  storyCount: number;
};

function BacklogToolbarActions(props: Omit<BacklogToolbarProps, "storyCount">) {
  return (
    <div className={styles.toolbarActions}>
      <ToolbarAction
        active={props.pipActive}
        icon={PictureInPicture2}
        label="Status PiP"
        onClick={props.onTogglePip}
      />
      <ToolbarAction
        icon={Plus}
        label="New User Story"
        onClick={props.onCreateStory}
        primary
      />
    </div>
  );
}

function ToolbarAction({
  active,
  icon: Icon,
  label,
  onClick,
  primary,
}: ToolbarActionProps) {
  const content = <ToolbarActionContent icon={Icon} label={label} />;
  const className = primary
    ? styles.primaryToolbarButton
    : styles.toolbarButton;
  if (!onClick) {
    return (
      <span className={className} data-active={active || undefined}>
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={active}
      className={className}
      onClick={onClick}
    >
      {content}
    </button>
  );
}

type ToolbarActionProps = {
  active?: boolean;
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  primary?: boolean;
};

function ToolbarActionContent({
  icon: Icon,
  label,
}: Pick<ToolbarActionProps, "icon" | "label">) {
  return (
    <>
      <Icon aria-hidden="true" />
      {label}
    </>
  );
}

function BacklogLane(props: BacklogLaneProps) {
  const laneStories = storiesForColumn(props.stories, props.column.id);
  return (
    <section className={styles.backlogLane} data-column={props.column.id}>
      <LaneHeader column={props.column} count={laneStories.length} />
      <div className={styles.laneBody}>
        <LaneStories
          columnId={props.column.id}
          onAction={props.onAction}
          onCreateStory={props.onCreateStory}
          onSelectStory={props.onSelectStory}
          selectedStoryId={props.selectedStoryId}
          showStories={props.showStories}
          stories={laneStories}
        />
      </div>
    </section>
  );
}

type BacklogLaneProps = {
  column: (typeof backlogColumns)[number];
  stories: ReadonlyArray<MockStory>;
  showStories: boolean;
  selectedStoryId?: string;
  onAction?: (storyId: string, action: StoryActionId) => void;
  onCreateStory?: () => void;
  onSelectStory?: (storyId: string) => void;
};

function LaneStories({ columnId, showStories, ...props }: LaneStoriesProps) {
  if (!showStories) return null;
  return (
    <>
      {props.stories.map((story) => (
        <StoryCard
          key={story.id}
          story={story}
          selected={story.id === props.selectedStoryId}
          onAction={props.onAction}
          onSelect={props.onSelectStory}
        />
      ))}
      {columnId === "backlog" ? (
        <NewStoryAction onClick={props.onCreateStory} />
      ) : null}
    </>
  );
}

type LaneStoriesProps = Omit<BacklogLaneProps, "column"> & {
  columnId: BacklogColumnId;
};

function LaneHeader({
  column,
  count,
}: {
  column: (typeof backlogColumns)[number];
  count: number;
}) {
  return (
    <header className={styles.laneHeader}>
      <span className={styles.laneDot} />
      <span className={styles.laneHeading}>
        <strong>{column.title}</strong>
        <small>{column.description}</small>
      </span>
      <span className={styles.laneCount}>{count}</span>
    </header>
  );
}

function NewStoryAction({ onClick }: { onClick?: () => void }) {
  if (!onClick) {
    return (
      <span className={styles.newStoryAction}>
        <Plus aria-hidden="true" />
        New User Story
      </span>
    );
  }
  return (
    <button type="button" className={styles.newStoryAction} onClick={onClick}>
      <Plus aria-hidden="true" />
      New User Story
    </button>
  );
}

function StoryCard({
  compact = false,
  onAction,
  onSelect,
  selected,
  story,
}: {
  compact?: boolean;
  onAction?: (storyId: string, action: StoryActionId) => void;
  onSelect?: (storyId: string) => void;
  selected?: boolean;
  story: MockStory;
}) {
  return (
    <article
      className={styles.storyStateEffect}
      data-selected={selected || undefined}
      data-story-state={story.status}
    >
      <div className={styles.storyCard} data-compact={compact || undefined}>
        <StoryCardHeader story={story} onSelect={onSelect} />
        {story.detail ? (
          <p className={styles.storyDetail}>{story.detail}</p>
        ) : null}
        <StoryActions compact={compact} story={story} onAction={onAction} />
      </div>
    </article>
  );
}

function StoryCardHeader({
  onSelect,
  story,
}: {
  onSelect?: (storyId: string) => void;
  story: MockStory;
}) {
  const title = <span>{story.title}</span>;
  return (
    <header className={styles.storyHeader}>
      <span className={styles.storyReference}>{story.reference}</span>
      <StatusBadge story={story} />
      {onSelect ? (
        <button type="button" onClick={() => onSelect(story.id)}>
          {title}
        </button>
      ) : (
        <strong>{title}</strong>
      )}
    </header>
  );
}

function StatusBadge({ story }: { story: MockStory }) {
  const label = storyStatusLabel(story);
  return (
    <span className={styles.statusBadge} data-tone={badgeTone(label)}>
      {label}
    </span>
  );
}

function StoryActions({
  compact,
  onAction,
  story,
}: {
  compact: boolean;
  onAction?: (storyId: string, action: StoryActionId) => void;
  story: MockStory;
}) {
  const runAction = onAction
    ? (action: StoryActionId) => onAction(story.id, action)
    : undefined;
  if (compact) {
    return (
      <ActionRow actions={[primaryStoryAction(story)]} onAction={runAction} />
    );
  }
  if (story.status === "in-progress" || story.status === "in-review") {
    return <DevelopmentActions story={story} onAction={runAction} />;
  }
  return <ActionRow actions={simpleStoryActions(story)} onAction={runAction} />;
}

function DevelopmentActions({
  onAction,
  story,
}: {
  onAction?: (action: StoryActionId) => void;
  story: MockStory;
}) {
  const finalActions: StoryActionId[] =
    story.status === "in-review"
      ? ["reject", "approve"]
      : story.agentStatus === "Paused"
        ? ["resume", "stop"]
        : ["stop"];
  return (
    <footer className={styles.developmentActions}>
      <ActionRow actions={["diff", "files", "terminal"]} onAction={onAction} />
      <ActionRow actions={["worktree", "preview"]} onAction={onAction} />
      <ActionRow actions={finalActions} onAction={onAction} alignEnd />
    </footer>
  );
}

function ActionRow({
  actions,
  alignEnd,
  onAction,
}: {
  actions: StoryActionId[];
  alignEnd?: boolean;
  onAction?: (action: StoryActionId) => void;
}) {
  return (
    <div className={styles.actionRow} data-align-end={alignEnd || undefined}>
      {actions.map((action) => (
        <StoryActionButton key={action} action={action} onAction={onAction} />
      ))}
    </div>
  );
}

function StoryActionButton({ action, onAction }: StoryActionButtonProps) {
  const config = actionConfig[action];
  if (!onAction) {
    return <StaticStoryAction config={config} />;
  }
  return (
    <InteractiveStoryAction
      action={action}
      config={config}
      onAction={onAction}
    />
  );
}

type StoryActionButtonProps = {
  action: StoryActionId;
  onAction?: (action: StoryActionId) => void;
};

function StaticStoryAction({ config }: { config: StoryActionConfig }) {
  return (
    <span
      className={styles.storyAction}
      data-icon-only={config.iconOnly || undefined}
      data-tone={config.tone}
    >
      <StoryActionContent config={config} />
    </span>
  );
}

function InteractiveStoryAction({
  action,
  config,
  onAction,
}: StoryActionButtonProps & {
  config: StoryActionConfig;
  onAction: NonNullable<StoryActionButtonProps["onAction"]>;
}) {
  return (
    <button
      type="button"
      aria-label={config.iconOnly ? config.label : undefined}
      className={styles.storyAction}
      data-icon-only={config.iconOnly || undefined}
      data-tone={config.tone}
      onClick={() => onAction(action)}
    >
      <StoryActionContent config={config} />
    </button>
  );
}

function StoryActionContent({ config }: { config: StoryActionConfig }) {
  const Icon = config.icon;
  return (
    <>
      <Icon aria-hidden="true" />
      {config.iconOnly ? null : <span>{config.label}</span>}
    </>
  );
}

function MovingPipelineStories({
  stories,
}: {
  stories: ReadonlyArray<MockStory>;
}) {
  return (
    <div className={styles.movingStoryLayer} aria-live="off">
      {stories.map((story, row) => (
        <div
          key={story.id}
          className={styles.movingStory}
          style={pipelineStoryPosition(story.status, row)}
        >
          <StoryCard compact story={story} />
        </div>
      ))}
    </div>
  );
}

function useHeroBacklog() {
  const [stories, setStories] = useState(() =>
    cloneStories(heroBacklogStories),
  );
  const [selectedStoryId, setSelectedStoryId] = useState<string>();
  const [pipActive, setPipActive] = useState(false);

  function runAction(storyId: string, action: StoryActionId) {
    setSelectedStoryId(storyId);
    setStories((current) => updateStoryCollection(current, storyId, action));
  }

  function createStory() {
    setSelectedStoryId("story-716");
    setStories((current) => addDraftStory(current));
  }

  return {
    createStory,
    pipActive,
    runAction,
    selectedStoryId,
    setSelectedStoryId,
    stories,
    togglePip: () => setPipActive((current) => !current),
  };
}

function usePipelineStories(paused: boolean) {
  const [stories, setStories] = useState(() =>
    cloneStories(pipelineBacklogStories),
  );
  useEffect(() => {
    if (paused) return;
    const interval = window.setInterval(() => {
      setStories((current) => current.map(advancePipelineStory));
    }, 2600);
    return () => window.clearInterval(interval);
  }, [paused]);
  return stories;
}

function useIntersectionVisible(ref: RefObject<HTMLElement | null>) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.08 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return visible;
}

function useDocumentVisible() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const syncVisibility = () =>
      setVisible(document.visibilityState === "visible");
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () =>
      document.removeEventListener("visibilitychange", syncVisibility);
  }, []);
  return visible;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setReduced(media.matches);
    syncPreference();
    media.addEventListener("change", syncPreference);
    return () => media.removeEventListener("change", syncPreference);
  }, []);
  return reduced;
}

function updateStoryCollection(
  stories: MockStory[],
  storyId: string,
  action: StoryActionId,
) {
  const story = stories.find((item) => item.id === storyId);
  if (!story) return stories;
  const updatedStory = storyAfterAction(story, action);
  if (!updatedStory) return stories.filter((item) => item.id !== storyId);
  return stories.map((item) => (item.id === storyId ? updatedStory : item));
}

function storyAfterAction(story: MockStory, action: StoryActionId) {
  if (action === "trash") return undefined;
  if (action === "send") return storyInStatus(story, "ready");
  if (action === "dequeue" || action === "rework") {
    return storyInStatus(story, "backlog");
  }
  if (action === "discard") {
    return {
      ...storyInStatus(story, "discarded"),
      detail: "Discarded from backlog",
    };
  }
  if (action === "reject") {
    return {
      ...storyInStatus(story, "discarded"),
      detail: "Rejected during review",
    };
  }
  if (action === "stop") return storyInStatus(story, "in-review");
  if (action === "resume") return { ...story, agentStatus: "Running" as const };
  if (action === "approve") {
    return {
      ...storyInStatus(story, "done"),
      detail: "Merged just now · 34ca91f",
    };
  }
  return story;
}

function storyInStatus(story: MockStory, status: BacklogColumnId): MockStory {
  return {
    ...story,
    agentStatus: status === "in-progress" ? "Running" : undefined,
    detail: undefined,
    status,
  };
}

function advancePipelineStory(story: MockStory) {
  const status = nextPipelineStatus(story.status);
  const nextStory = storyInStatus(story, status);
  if (status === "done") return { ...nextStory, detail: "Merged moments ago" };
  if (status === "discarded")
    return { ...nextStory, detail: "Ready to rework" };
  return nextStory;
}

function addDraftStory(stories: MockStory[]) {
  if (stories.some((story) => story.id === "story-716")) return stories;
  return [
    ...stories,
    {
      id: "story-716",
      reference: "US-716",
      title: "Document the release readiness flow",
      status: "backlog" as const,
    },
  ];
}

function simpleStoryActions(story: MockStory): StoryActionId[] {
  if (story.status === "backlog") return ["discard", "send"];
  if (story.status === "ready") return ["dequeue"];
  if (story.status === "done") return ["diff", "use-context"];
  return ["trash", "rework"];
}

function primaryStoryAction(story: MockStory): StoryActionId {
  if (story.status === "backlog") return "send";
  if (story.status === "ready") return "dequeue";
  if (story.status === "in-progress") return "stop";
  if (story.status === "in-review") return "approve";
  if (story.status === "done") return "use-context";
  return "rework";
}

function badgeTone(label: string) {
  if (label === "Running") return "running";
  if (label === "Paused") return "paused";
  if (label === "Merged") return "merged";
  if (label === "Rejected") return "rejected";
  if (label === "Draft") return "draft";
  return "queued";
}

function pipelineStoryPosition(status: BacklogColumnId, row: number) {
  const laneIndex = backlogColumns.findIndex((column) => column.id === status);
  const lanePercentage = laneIndex * (100 / backlogColumns.length);
  const laneGapOffset = 0.48 + laneIndex * 0.075;
  return {
    "--lane-offset": `calc(${lanePercentage}% + ${laneGapOffset}cqw)`,
    "--story-offset": `${row * 6.1}cqw`,
  } as CSSProperties;
}

function cloneStories(stories: ReadonlyArray<MockStory>) {
  return stories.map((story) => ({ ...story }));
}

function storiesForColumn(
  stories: ReadonlyArray<MockStory>,
  id: BacklogColumnId,
) {
  return stories.filter((story) => story.status === id);
}

function focusStayedInside(event: FocusEvent<HTMLDivElement>) {
  return event.currentTarget.contains(event.relatedTarget as Node | null);
}
