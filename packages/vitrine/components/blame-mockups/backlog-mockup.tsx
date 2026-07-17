"use client";

import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
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
  pipelineStoryTitles,
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

type BacklogController = {
  createStory: () => void;
  pipActive: boolean;
  runAction: (storyId: string, action: StoryActionId) => void;
  stories: MockStory[];
  togglePip: () => void;
};

type PipelineDelayRange = readonly [minimum: number, maximum: number];
type StorySetter = Dispatch<SetStateAction<MockStory[]>>;

const pipelineBatchSize = 3;

const pipelineDelayRanges: Record<BacklogColumnId, PipelineDelayRange> = {
  backlog: [1000, 1500],
  ready: [500, 800],
  "in-progress": [3500, 5500],
  "in-review": [1800, 3800],
  done: [2600, 4000],
  discarded: [2200, 3400],
};

const pipelineReschedulingActions = new Set<StoryActionId>([
  "approve",
  "dequeue",
  "discard",
  "reject",
  "rework",
  "send",
  "stop",
  "trash",
]);

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
    <div className={styles.mockupFrame} data-variant="hero">
      <BlameAppShell>
        <InteractiveBacklogBoard backlog={backlog} />
      </BlameAppShell>
    </div>
  );
}

export function PipelineBacklogMockup() {
  const documentVisible = useDocumentVisible();
  const backlog = usePipelineBacklog(!documentVisible);

  return (
    <div className={styles.mockupFrame} data-variant="pipeline">
      <BlameAppShell>
        <InteractiveBacklogBoard backlog={backlog} />
      </BlameAppShell>
    </div>
  );
}

function InteractiveBacklogBoard({ backlog }: { backlog: BacklogController }) {
  return (
    <BacklogBoard
      stories={backlog.stories}
      onAction={backlog.runAction}
      onCreateStory={backlog.createStory}
      onTogglePip={backlog.togglePip}
      pipActive={backlog.pipActive}
    />
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
  onTogglePip?: () => void;
  pipActive?: boolean;
};

function BoardLanes(props: BacklogBoardProps) {
  return (
    <div className={styles.boardGrid}>
      {backlogColumns.map((column) => (
        <BacklogLane
          key={column.id}
          column={column}
          stories={props.stories}
          onAction={props.onAction}
          onCreateStory={props.onCreateStory}
        />
      ))}
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
          stories={laneStories}
        />
      </div>
    </section>
  );
}

type BacklogLaneProps = {
  column: (typeof backlogColumns)[number];
  stories: ReadonlyArray<MockStory>;
  onAction?: (storyId: string, action: StoryActionId) => void;
  onCreateStory?: () => void;
};

function LaneStories({ columnId, ...props }: LaneStoriesProps) {
  return (
    <>
      {props.stories.map((story) => (
        <StoryCard key={story.id} story={story} onAction={props.onAction} />
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
  onAction,
  story,
}: {
  onAction?: (storyId: string, action: StoryActionId) => void;
  story: MockStory;
}) {
  return (
    <article
      className={styles.storyStateEffect}
      data-story-state={story.status}
    >
      <div className={styles.storyCard}>
        <StoryCardHeader story={story} />
        {story.detail ? (
          <p className={styles.storyDetail}>{story.detail}</p>
        ) : null}
        <StoryActions story={story} onAction={onAction} />
      </div>
    </article>
  );
}

function StoryCardHeader({ story }: { story: MockStory }) {
  return (
    <header className={styles.storyHeader}>
      <span className={styles.storyReference}>{story.reference}</span>
      <StatusBadge story={story} />
      <strong>
        <span>{story.title}</span>
      </strong>
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
  onAction,
  story,
}: {
  onAction?: (storyId: string, action: StoryActionId) => void;
  story: MockStory;
}) {
  const runAction = onAction
    ? (action: StoryActionId) => onAction(story.id, action)
    : undefined;
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

function useHeroBacklog() {
  const [stories, setStories] = useState(() =>
    cloneStories(heroBacklogStories),
  );
  const [pipActive, setPipActive] = useState(false);

  function runAction(storyId: string, action: StoryActionId) {
    setStories((current) => updateStoryCollection(current, storyId, action));
  }

  function createStory() {
    setStories((current) => addDraftStory(current));
  }

  return {
    createStory,
    pipActive,
    runAction,
    stories,
    togglePip: () => setPipActive((current) => !current),
  };
}

function usePipelineBacklog(paused: boolean): BacklogController {
  const pipeline = usePipelineStories(paused);
  const [pipActive, setPipActive] = useState(false);

  return {
    createStory: pipeline.createStory,
    pipActive,
    runAction: pipeline.runAction,
    stories: pipeline.stories,
    togglePip: () => setPipActive((current) => !current),
  };
}

function usePipelineStories(paused: boolean) {
  const [stories, setStories] = useState(() => createPipelineBatch(0));
  const batchIndex = useRef(0);
  const storyTimers = useRef(new Map<string, number>());
  const replacementTimer = useRef<number | undefined>(undefined);

  usePipelineSchedule(
    paused,
    stories,
    batchIndex,
    storyTimers,
    replacementTimer,
    setStories,
  );

  return {
    createStory: () =>
      createPipelineStory(
        batchIndex,
        storyTimers.current,
        replacementTimer,
        setStories,
      ),
    runAction: (storyId: string, action: StoryActionId) =>
      runPipelineAction(storyId, action, storyTimers.current, setStories),
    stories,
  };
}

function usePipelineSchedule(
  paused: boolean,
  stories: MockStory[],
  batchIndex: RefObject<number>,
  storyTimers: RefObject<Map<string, number>>,
  replacementTimer: RefObject<number | undefined>,
  setStories: StorySetter,
) {
  const timers = storyTimers;
  const replacement = replacementTimer;
  useEffect(() => {
    if (paused) {
      clearPipelineSchedule(timers.current, replacement);
      return;
    }
    scheduleStoryTransitions(stories, timers.current, setStories);
    scheduleNextPipelineBatch(stories, batchIndex, replacement, setStories);
  }, [batchIndex, paused, replacement, setStories, stories, timers]);

  useEffect(
    () => () => clearPipelineSchedule(timers.current, replacement),
    [replacement, timers],
  );
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

function scheduleStoryTransitions(
  stories: ReadonlyArray<MockStory>,
  timers: Map<string, number>,
  setStories: StorySetter,
) {
  stories.forEach((story) => {
    if (isTerminalStory(story) || timers.has(story.id)) return;
    const timer = window.setTimeout(() => {
      timers.delete(story.id);
      setStories((current) =>
        current.map((item) =>
          item.id === story.id ? advancePipelineStory(item) : item,
        ),
      );
    }, randomPipelineDelay(story.status));
    timers.set(story.id, timer);
  });
}

function scheduleNextPipelineBatch(
  stories: ReadonlyArray<MockStory>,
  batchIndex: RefObject<number>,
  replacementTimer: RefObject<number | undefined>,
  setStories: StorySetter,
) {
  if (!stories.every(isTerminalStory)) {
    clearReplacementTimer(replacementTimer);
    return;
  }
  if (replacementTimer.current !== undefined) return;
  replacementTimer.current = window.setTimeout(() => {
    batchIndex.current += 1;
    setStories(createPipelineBatch(batchIndex.current));
    replacementTimer.current = undefined;
  }, terminalBatchDelay(stories));
}

function runPipelineAction(
  storyId: string,
  action: StoryActionId,
  timers: Map<string, number>,
  setStories: StorySetter,
) {
  if (pipelineReschedulingActions.has(action)) {
    clearStoryTimer(storyId, timers);
  }
  setStories((current) => updateStoryCollection(current, storyId, action));
}

function createPipelineStory(
  batchIndex: RefObject<number>,
  timers: Map<string, number>,
  replacementTimer: RefObject<number | undefined>,
  setStories: StorySetter,
) {
  clearPipelineSchedule(timers, replacementTimer);
  batchIndex.current += 1;
  const [draft] = createPipelineBatch(batchIndex.current);
  setStories((current) => addPipelineDraft(current, draft));
  return draft.id;
}

function addPipelineDraft(stories: MockStory[], draft: MockStory) {
  if (stories.length < pipelineBatchSize) return [...stories, draft];
  const terminalIndex = stories.findIndex(isTerminalStory);
  const replacementIndex = terminalIndex === -1 ? 0 : terminalIndex;
  return stories.filter((_, index) => index !== replacementIndex).concat(draft);
}

function clearStoryTimer(storyId: string, timers: Map<string, number>) {
  const timer = timers.get(storyId);
  if (timer !== undefined) window.clearTimeout(timer);
  timers.delete(storyId);
}

function clearReplacementTimer(
  replacementTimer: RefObject<number | undefined>,
) {
  if (replacementTimer.current !== undefined) {
    window.clearTimeout(replacementTimer.current);
  }
  replacementTimer.current = undefined;
}

function clearPipelineSchedule(
  timers: Map<string, number>,
  replacementTimer: RefObject<number | undefined>,
) {
  timers.forEach((timer) => window.clearTimeout(timer));
  timers.clear();
  clearReplacementTimer(replacementTimer);
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
  if (status === "discarded") {
    return { ...nextStory, detail: "Rejected during review" };
  }
  return nextStory;
}

function nextPipelineStatus(status: BacklogColumnId): BacklogColumnId {
  if (status === "backlog") return "ready";
  if (status === "ready") return "in-progress";
  if (status === "in-progress") return "in-review";
  if (status === "in-review") {
    return Math.random() < 0.8 ? "done" : "discarded";
  }
  return status;
}

function createPipelineBatch(batchIndex: number): MockStory[] {
  return Array.from({ length: pipelineBatchSize }, (_, position) => {
    const sequence = batchIndex * pipelineBatchSize + position;
    const storyNumber = 804 + sequence;
    return {
      id: `pipeline-${batchIndex}-${position}`,
      reference: `US-${storyNumber}`,
      title: pipelineStoryTitles[sequence % pipelineStoryTitles.length],
      status: "backlog" as const,
    };
  });
}

function randomPipelineDelay(status: BacklogColumnId) {
  const [minimum, maximum] = pipelineDelayRanges[status];
  return Math.round(minimum + Math.random() * (maximum - minimum));
}

function terminalBatchDelay(stories: ReadonlyArray<MockStory>) {
  return Math.max(...stories.map((story) => randomPipelineDelay(story.status)));
}

function isTerminalStory(story: MockStory) {
  return story.status === "done" || story.status === "discarded";
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

function badgeTone(label: string) {
  if (label === "Running") return "running";
  if (label === "Paused") return "paused";
  if (label === "Merged") return "merged";
  if (label === "Rejected") return "rejected";
  if (label === "Draft") return "draft";
  return "queued";
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
