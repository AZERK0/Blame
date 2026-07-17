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

type DrawerTab = "story" | "preview" | "code";
type PreviewTab = "preview" | "logs";
type MockupTab<T extends string> = {
  id: T;
  label: string;
  Icon: typeof BookOpenIcon;
};
type AccessibleTabListProps<T extends string> = {
  activeTab: T;
  ariaLabel: string;
  className: string;
  idPrefix: string;
  tabs: ReadonlyArray<MockupTab<T>>;
  onTabChange: (tab: T) => void;
};
type AccessibleTabButtonProps<T extends string> = {
  index: number;
  listProps: AccessibleTabListProps<T>;
  tab: MockupTab<T>;
};
type PreviewToolbarProps = {
  captured: boolean;
  path: string;
  previewTab: PreviewTab;
  refreshing: boolean;
  tabsId: string;
  onCapture: () => void;
  onPathChange: (path: string) => void;
  onRefresh: () => void;
  onTabChange: (tab: PreviewTab) => void;
};
type PreviewActionsProps = Pick<
  PreviewToolbarProps,
  "captured" | "refreshing" | "onCapture" | "onRefresh"
>;

const drawerTabs: ReadonlyArray<MockupTab<DrawerTab>> = [
  { id: "story", label: "User Story", Icon: BookOpenIcon },
  { id: "preview", label: "Preview", Icon: AppWindowIcon },
  { id: "code", label: "Code", Icon: CodeIcon },
];

const previewTabs: ReadonlyArray<MockupTab<PreviewTab>> = [
  { id: "preview", label: "Preview", Icon: MonitorIcon },
  { id: "logs", label: "Run logs", Icon: PlayIcon },
];

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

const logLines = [
  { time: "10:42:08", text: "Starting web preview on port 46023" },
  { time: "10:42:09", text: "Compiled successfully in 412ms" },
  { time: "10:42:09", text: "Local: http://localhost:46023/" },
  { time: "10:42:13", text: "GET / 200 in 38ms" },
] as const;

export function LivePreviewMockup() {
  const [drawerTab, setDrawerTab] = React.useState<DrawerTab>("preview");
  const drawerTabsId = React.useId();

  return (
    <section
      className={styles.scene}
      aria-label="Interactive Blame live preview mockup"
    >
      <div className={styles.backdrop} aria-hidden="true">
        <StaticBacklogMockup />
      </div>
      <PreviewDrawer
        activeTab={drawerTab}
        tabsId={drawerTabsId}
        onTabChange={setDrawerTab}
      />
    </section>
  );
}

function PreviewDrawer({
  activeTab,
  tabsId,
  onTabChange,
}: {
  activeTab: DrawerTab;
  tabsId: string;
  onTabChange: (tab: DrawerTab) => void;
}) {
  return (
    <div className={styles.drawer}>
      <DrawerHeader
        activeTab={activeTab}
        tabsId={tabsId}
        onTabChange={onTabChange}
      />
      <DrawerPanels activeTab={activeTab} tabsId={tabsId} />
    </div>
  );
}

function DrawerHeader({
  activeTab,
  tabsId,
  onTabChange,
}: {
  activeTab: DrawerTab;
  tabsId: string;
  onTabChange: (tab: DrawerTab) => void;
}) {
  return (
    <header className={styles.drawerHeader}>
      <div className={styles.headerBlur} />
      <h2>Untitled user story</h2>
      <div className={styles.storyMeta}>
        <span className={styles.status}>In Progress</span>
        <span>Product created this</span>
        <span>Jul 2, 2026</span>
      </div>
      <OuterTabs
        activeTab={activeTab}
        tabsId={tabsId}
        onTabChange={onTabChange}
      />
      <span className={styles.closeButton} aria-hidden="true">
        <XIcon />
      </span>
    </header>
  );
}

function OuterTabs({
  activeTab,
  tabsId,
  onTabChange,
}: {
  activeTab: DrawerTab;
  tabsId: string;
  onTabChange: (tab: DrawerTab) => void;
}) {
  return (
    <AccessibleTabList
      activeTab={activeTab}
      ariaLabel="User story views"
      className={styles.outerTabs}
      idPrefix={tabsId}
      tabs={drawerTabs}
      onTabChange={onTabChange}
    />
  );
}

function AccessibleTabList<T extends string>(props: AccessibleTabListProps<T>) {
  return (
    <div
      className={props.className}
      role="tablist"
      aria-label={props.ariaLabel}
    >
      {props.tabs.map((tab, index) => (
        <AccessibleTabButton
          key={tab.id}
          index={index}
          listProps={props}
          tab={tab}
        />
      ))}
    </div>
  );
}

function AccessibleTabButton<T extends string>({
  index,
  listProps,
  tab,
}: AccessibleTabButtonProps<T>) {
  const { Icon, id, label } = tab;
  const active = listProps.activeTab === id;
  return (
    <button
      type="button"
      role="tab"
      id={tabId(listProps.idPrefix, id)}
      aria-controls={panelId(listProps.idPrefix, id)}
      aria-label={label}
      aria-selected={active}
      data-active={active}
      tabIndex={active ? 0 : -1}
      onClick={() => listProps.onTabChange(id)}
      onKeyDown={(event) => handleTabKey(event, index, listProps)}
    >
      <Icon />
      <span>{label}</span>
    </button>
  );
}

function handleTabKey<T extends string>(
  event: React.KeyboardEvent<HTMLButtonElement>,
  index: number,
  props: AccessibleTabListProps<T>,
) {
  const nextIndex = tabIndexForKey(event.key, index, props.tabs.length);
  if (nextIndex === undefined) return;
  const tabList = event.currentTarget.parentElement;
  event.preventDefault();
  props.onTabChange(props.tabs[nextIndex].id);
  tabList
    ?.querySelectorAll<HTMLButtonElement>("[role='tab']")
    [nextIndex]?.focus();
}

function tabIndexForKey(key: string, index: number, length: number) {
  if (key === "ArrowRight") return (index + 1) % length;
  if (key === "ArrowLeft") return (index - 1 + length) % length;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  return undefined;
}

function tabId(prefix: string, tab: string) {
  return `${prefix}-tab-${tab}`;
}

function panelId(prefix: string, tab: string) {
  return `${prefix}-panel-${tab}`;
}

function DrawerPanels({
  activeTab,
  tabsId,
}: {
  activeTab: DrawerTab;
  tabsId: string;
}) {
  const panels: Record<DrawerTab, React.ReactNode> = {
    story: <UserStoryPanel />,
    preview: <PreviewPanel />,
    code: <CodePanel />,
  };
  return drawerTabs.map(({ id }) => (
    <TabPanel key={id} activeTab={activeTab} idPrefix={tabsId} tab={id}>
      {panels[id]}
    </TabPanel>
  ));
}

function TabPanel<T extends string>({
  activeTab,
  children,
  className,
  idPrefix,
  tab,
}: {
  activeTab: T;
  children: React.ReactNode;
  className?: string;
  idPrefix: string;
  tab: T;
}) {
  return (
    <div
      role="tabpanel"
      id={panelId(idPrefix, tab)}
      aria-labelledby={tabId(idPrefix, tab)}
      className={className}
      hidden={activeTab !== tab}
      tabIndex={0}
    >
      {children}
    </div>
  );
}

function PreviewPanel() {
  const [previewTab, setPreviewTab] = React.useState<PreviewTab>("preview");
  const [path, setPath] = React.useState("/");
  const [refreshing, refresh] = useTransientFlag(650);
  const [captured, capture] = useTransientFlag(1100);
  const previewTabsId = React.useId();

  return (
    <div className={styles.previewPanel}>
      <PreviewToolbar
        captured={captured}
        path={path}
        previewTab={previewTab}
        refreshing={refreshing}
        tabsId={previewTabsId}
        onCapture={capture}
        onPathChange={setPath}
        onRefresh={refresh}
        onTabChange={setPreviewTab}
      />
      <BrowserFrame
        path={path}
        previewTab={previewTab}
        refreshing={refreshing}
        tabsId={previewTabsId}
      />
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
  previewTab,
  refreshing,
  tabsId,
  onCapture,
  onPathChange,
  onRefresh,
  onTabChange,
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
      <PreviewTabs
        activeTab={previewTab}
        tabsId={tabsId}
        onTabChange={onTabChange}
      />
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

function PreviewTabs({
  activeTab,
  tabsId,
  onTabChange,
}: {
  activeTab: PreviewTab;
  tabsId: string;
  onTabChange: (tab: PreviewTab) => void;
}) {
  return (
    <AccessibleTabList
      activeTab={activeTab}
      ariaLabel="Preview output"
      className={styles.previewTabs}
      idPrefix={tabsId}
      tabs={previewTabs}
      onTabChange={onTabChange}
    />
  );
}

function BrowserFrame({
  path,
  previewTab,
  refreshing,
  tabsId,
}: {
  path: string;
  previewTab: PreviewTab;
  refreshing: boolean;
  tabsId: string;
}) {
  return (
    <div className={styles.browserFrame} aria-busy={refreshing}>
      <PreviewOutputPanels activeTab={previewTab} path={path} tabsId={tabsId} />
      {refreshing ? <LoadingCover /> : null}
    </div>
  );
}

function PreviewOutputPanels({
  activeTab,
  path,
  tabsId,
}: {
  activeTab: PreviewTab;
  path: string;
  tabsId: string;
}) {
  const panels: Record<PreviewTab, React.ReactNode> = {
    preview: <MiniSite path={path} />,
    logs: <RunLogs />,
  };
  return previewTabs.map(({ id }) => (
    <TabPanel
      key={id}
      activeTab={activeTab}
      className={styles.browserTabPanel}
      idPrefix={tabsId}
      tab={id}
    >
      {panels[id]}
    </TabPanel>
  ));
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
        The industrial-grade
        <br />
        agentic IDE.
      </h3>
      <p>
        Turn every request into an isolated worktree,
        <br />
        with live preview, diffs, and controlled merge.
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

function RunLogs() {
  return (
    <div className={styles.runLogs}>
      <div className={styles.logHeader}>
        <span className={styles.runningDot} />
        Web application <strong>running</strong>
      </div>
      <div className={styles.logBody}>
        {logLines.map((line, index) => (
          <div key={line.time + line.text}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <time>{line.time}</time>
            <code>{line.text}</code>
          </div>
        ))}
        <div className={styles.logCursor}>
          <span>05</span>
          <time>10:42:13</time>
          <code>
            ready <i />
          </code>
        </div>
      </div>
    </div>
  );
}

function UserStoryPanel() {
  return (
    <div className={styles.detailPanel}>
      <div className={styles.detailMain}>
        <span className={styles.detailEyebrow}>User story</span>
        <h3>Build a live project preview</h3>
        <p>
          As a product engineer, I can inspect the agent output while it works
          so feedback stays fast and grounded.
        </p>
        <h4>Acceptance criteria</h4>
        <Checklist
          items={[
            "Preview opens inside the story",
            "Refresh keeps the active path",
            "Run logs remain one click away",
          ]}
        />
      </div>
      <aside className={styles.activityCard}>
        <span>Activity</span>
        <b>Agent started a worktree</b>
        <small>2 minutes ago</small>
        <b>Preview is ready</b>
        <small>Just now</small>
      </aside>
    </div>
  );
}

function Checklist({ items }: { items: string[] }) {
  return (
    <div className={styles.checklist}>
      {items.map((item, index) => (
        <span key={item}>
          <i data-checked={index < 2}>{index < 2 ? <CheckIcon /> : null}</i>
          {item}
        </span>
      ))}
    </div>
  );
}

function CodePanel() {
  return (
    <div className={styles.codePanel}>
      <aside>
        <strong>Files</strong>
        <span>app</span>
        <span className={styles.activeFile}>page.tsx</span>
        <span>globals.css</span>
        <span>components</span>
        <span>preview.tsx</span>
      </aside>
      <CodeEditor />
    </div>
  );
}

function CodeEditor() {
  return (
    <div className={styles.editor}>
      <div className={styles.editorBar}>
        <span>page.tsx</span>
        <small>TypeScript React</small>
      </div>
      <pre>
        <code>
          <i>1</i>
          <b>export default function</b> Product() {"{"}
          {"\n"}
          <i>2</i> <b>return</b> ({"\n"}
          <i>3</i> &lt;main className=<em>&quot;product&quot;</em>&gt;{"\n"}
          <i>4</i> &lt;Preview /&gt;{"\n"}
          <i>5</i> &lt;/main&gt;{"\n"}
          <i>6</i> ){"\n"}
          <i>7</i>
          {"}"}
        </code>
      </pre>
    </div>
  );
}
