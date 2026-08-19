"use client";

import * as React from "react";
import {
  AppWindowIcon,
  BookOpenIcon,
  CheckIcon,
  CodeIcon,
  ExternalLinkIcon,
  FocusIcon,
  MonitorIcon,
  PlayIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";

import { StaticBacklogMockup } from "./backlog-mockup";
import styles from "./preview-mockup.module.css";

type PreviewToolbarProps = {
  captured: boolean;
  path: string;
  refreshing: boolean;
  onCapture: () => void;
  onPathChange: (path: string) => void;
  onRefresh: () => void;
};
type PreviewActionsProps = Pick<
  PreviewToolbarProps,
  "captured" | "refreshing" | "onCapture" | "onRefresh"
>;

const drawerModes = [
  { label: "User Story", Icon: BookOpenIcon },
  { label: "Preview", Icon: AppWindowIcon },
  { label: "Code", Icon: CodeIcon },
] as const;

const toolbarModes = [
  { label: "Preview", Icon: MonitorIcon },
  { label: "Run logs", Icon: PlayIcon },
] as const;

const boardColumns = [
  { title: "Backlog", tone: "mint", tickets: ["Refine onboarding"] },
  { title: "Agent Queue", tone: "blue", tickets: ["Secure credentials"] },
  {
    title: "In Progress",
    tone: "amber",
    tickets: ["Repository insights", "Preview checks"],
  },
  { title: "In Review", tone: "violet", tickets: ["Merge readiness"] },
  {
    title: "Done",
    tone: "orange",
    tickets: ["Guided backlog", "Project switcher"],
  },
  { title: "Discarded", tone: "rose", tickets: ["Health snapshot"] },
] as const;

export function LivePreviewMockup() {
  return (
    <section
      className={styles.scene}
      aria-label="Interactive Blame live preview mockup"
    >
      <div className={styles.backdrop} aria-hidden="true">
        <StaticBacklogMockup />
      </div>
      <PreviewDrawer />
    </section>
  );
}

function PreviewDrawer() {
  return (
    <div className={styles.drawer}>
      <DrawerHeader />
      <PreviewPanel />
    </div>
  );
}

function DrawerHeader() {
  return (
    <header className={styles.drawerHeader}>
      <div className={styles.headerBlur} />
      <h2>Untitled user story</h2>
      <div className={styles.storyMeta}>
        <span className={styles.status}>In Progress</span>
        <span>Product created this</span>
        <span>Jul 2, 2026</span>
      </div>
      <PreviewMode location="drawer" />
      <span className={styles.closeButton} aria-hidden="true">
        <XIcon />
      </span>
    </header>
  );
}

function PreviewMode({ location }: { location: "drawer" | "toolbar" }) {
  const modes = location === "drawer" ? drawerModes : toolbarModes;
  return (
    <div
      className={location === "drawer" ? styles.drawerMode : styles.toolbarMode}
    >
      {modes.map(({ Icon, label }) => (
        <button
          key={label}
          type="button"
          data-active={label === "Preview"}
          disabled
        >
          <Icon />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

function PreviewPanel() {
  const [path, setPath] = React.useState("/");
  const [refreshing, refresh] = useTransientFlag(650);
  const [captured, capture] = useTransientFlag(1100);

  return (
    <div className={styles.previewPanel}>
      <PreviewToolbar
        captured={captured}
        path={path}
        refreshing={refreshing}
        onCapture={capture}
        onPathChange={setPath}
        onRefresh={refresh}
      />
      <BrowserFrame path={path} refreshing={refreshing} />
    </div>
  );
}

function useTransientFlag(duration: number) {
  const [activation, setActivation] = React.useState(0);

  React.useEffect(() => {
    if (!activation) return;
    const timeout = window.setTimeout(() => setActivation(0), duration);
    return () => window.clearTimeout(timeout);
  }, [activation, duration]);

  return [
    activation > 0,
    () => setActivation((current) => current + 1),
  ] as const;
}

function PreviewToolbar({
  captured,
  path,
  refreshing,
  onCapture,
  onPathChange,
  onRefresh,
}: PreviewToolbarProps) {
  return (
    <div className={styles.previewToolbar}>
      <AddressBar path={path} onPathChange={onPathChange} />
      <PreviewActions
        captured={captured}
        refreshing={refreshing}
        onCapture={onCapture}
        onRefresh={onRefresh}
      />
      <span className={styles.toolbarSpacer} />
      <PreviewMode location="toolbar" />
    </div>
  );
}

function AddressBar({
  path,
  onPathChange,
}: Pick<PreviewToolbarProps, "path" | "onPathChange">) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const commit = () => onPathChange(normalizePreviewPath(path));

  return (
    <div className={styles.addressBar}>
      <span>http://localhost:46023</span>
      <input
        ref={inputRef}
        aria-label="Preview path"
        spellCheck={false}
        value={path}
        onBlur={commit}
        onChange={(event) => onPathChange(event.currentTarget.value)}
        onKeyDown={(event) =>
          handleAddressKey(event, commit, () => onPathChange("/"))
        }
      />
      <button
        type="button"
        aria-label="Edit preview address"
        onClick={() => inputRef.current?.focus()}
      >
        <ExternalLinkIcon />
      </button>
    </div>
  );
}

function handleAddressKey(
  event: React.KeyboardEvent<HTMLInputElement>,
  commit: () => void,
  reset: () => void,
) {
  if (event.key === "Enter") event.currentTarget.blur();
  if (event.key !== "Escape") return;
  const input = event.currentTarget;
  event.preventDefault();
  reset();
  requestAnimationFrame(() => input.blur());
}

function normalizePreviewPath(path: string) {
  const cleaned = path.trim().replace(/\s+/g, "-");
  if (!cleaned) return "/";
  return cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
}

function PreviewActions({
  captured,
  refreshing,
  onCapture,
  onRefresh,
}: PreviewActionsProps) {
  return (
    <div className={styles.previewActions}>
      <button
        type="button"
        aria-label="Refresh preview"
        aria-busy={refreshing}
        onClick={onRefresh}
      >
        <RefreshCwIcon className={refreshing ? styles.spinning : undefined} />
      </button>
      <button
        type="button"
        aria-label="Capture preview"
        data-captured={captured}
        onClick={onCapture}
      >
        {captured ? <CheckIcon /> : <FocusIcon />}
      </button>
      <CaptureFeedback captured={captured} />
    </div>
  );
}

function CaptureFeedback({ captured }: { captured: boolean }) {
  return (
    <>
      {captured ? (
        <span className={styles.captureToast}>Snapshot captured</span>
      ) : null}
      <span className={styles.srOnly} aria-live="polite">
        {captured ? "Preview snapshot captured" : ""}
      </span>
    </>
  );
}

function BrowserFrame({
  path,
  refreshing,
}: {
  path: string;
  refreshing: boolean;
}) {
  return (
    <div className={styles.browserFrame} aria-busy={refreshing}>
      <MiniSite path={path} />
      {refreshing ? <LoadingCover /> : null}
    </div>
  );
}

function LoadingCover() {
  return (
    <div className={styles.loadingCover} role="status">
      <RefreshCwIcon className={styles.spinning} />
      <span className={styles.srOnly}>Refreshing preview</span>
    </div>
  );
}

function MiniSite({ path }: { path: string }) {
  return (
    <div className={styles.miniSite}>
      <MiniNavigation />
      <MiniHero path={path} />
      <MiniBacklog />
      <span className={styles.siteScrollbar}>
        <span />
      </span>
    </div>
  );
}

function MiniNavigation() {
  return (
    <nav
      className={styles.miniNavigation}
      aria-label="Preview website navigation"
    >
      <span className={styles.miniBrand}>
        <span className={styles.miniMark}>b</span>Blame
      </span>
      <span className={styles.miniLinks}>
        <strong>Product</strong>
        <span>Pricing</span>
        <span>Download</span>
      </span>
      <span className={styles.earlyAccess}>Early access</span>
    </nav>
  );
}

function MiniHero({ path }: { path: string }) {
  return (
    <div className={styles.miniHero}>
      <span className={styles.previewPath}>{path}</span>
      <h3>
        <span className="block whitespace-nowrap">The ADE that</span>
        <span className="block whitespace-nowrap">sets the standard</span>
      </h3>
      <p>
        From story to controlled merge, one verifiable harness
        <br />
        unifies agents, Code Practices, smart worktrees, and live Cloud Previews.
      </p>
      <div className={styles.heroButtons}>
        <span>
          Request access <span aria-hidden="true">→</span>
        </span>
        <span>
          <PlayIcon /> See the workflow
        </span>
      </div>
    </div>
  );
}

function MiniBacklog() {
  return (
    <div className={styles.miniBacklog} aria-hidden="true">
      <div className={styles.miniWindowBar}>
        <i />
        <i />
        <i />
        <span>Backlog</span>
      </div>
      <div className={styles.miniAppBody}>
        <div className={styles.miniSidebar}>
          <b>B</b>
          <span />
          <span />
          <span />
        </div>
        <div className={styles.miniColumns}>
          {boardColumns.map((column) => (
            <MiniColumn key={column.title} {...column} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MiniColumn({ tickets, title, tone }: (typeof boardColumns)[number]) {
  return (
    <div className={styles.miniColumn} data-tone={tone}>
      <strong>
        <i />
        {title}
      </strong>
      {tickets.map((ticket) => (
        <span key={ticket}>
          <small>US-{700 + ticket.length}</small>
          {ticket}
          <i />
        </span>
      ))}
    </div>
  );
}
