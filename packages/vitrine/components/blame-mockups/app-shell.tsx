import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  CloudUpload,
  GitBranch,
  MessageCircle,
  MoreVertical,
  PanelLeft,
  Play,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  Table2,
  Terminal,
} from "lucide-react";

import styles from "./backlog-mockup.module.css";

type ShellNavigationItem = {
  label: string;
  icon: LucideIcon;
  active?: boolean;
};

const mainNavigation: ShellNavigationItem[] = [
  { label: "Backlog", icon: Table2, active: true },
  { label: "Chats", icon: MessageCircle },
  { label: "Git", icon: GitBranch },
];

const projectNavigation: ShellNavigationItem[] = [
  { label: "Code Practices", icon: ClipboardCheck },
  { label: "Security Audit", icon: ShieldCheck },
  { label: "Deploy", icon: CloudUpload },
];

const secondaryNavigation: ShellNavigationItem[] = [
  { label: "Settings", icon: Settings2 },
  { label: "Get Help", icon: CircleHelp },
  { label: "Search", icon: Search },
];

export function BlameAppShell({
  ariaHidden = false,
  children,
  className,
  interactive = true,
}: {
  ariaHidden?: boolean;
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <section
      aria-hidden={ariaHidden || undefined}
      aria-label={ariaHidden ? undefined : "Blame backlog application mockup"}
      className={[styles.appShell, className].filter(Boolean).join(" ")}
    >
      <AppSidebar interactive={interactive} />
      <div className={styles.appMain}>
        <AppHeader interactive={interactive} />
        <div className={styles.appContent}>{children}</div>
      </div>
    </section>
  );
}

function AppSidebar({ interactive }: { interactive: boolean }) {
  return (
    <aside className={styles.sidebar}>
      <ProjectSelector interactive={interactive} />
      <nav className={styles.sidebarNavigation} aria-label="App navigation">
        <NavigationItems items={mainNavigation} interactive={interactive} />
        <NavigationGroup
          label="Project"
          items={projectNavigation}
          interactive={interactive}
        />
      </nav>
      <NavigationItems
        className={styles.secondaryNavigation}
        items={secondaryNavigation}
        interactive={interactive}
      />
      <UserProfile interactive={interactive} />
    </aside>
  );
}

function ProjectSelector({ interactive }: { interactive: boolean }) {
  return (
    <button
      type="button"
      className={styles.projectSelector}
      disabled={!interactive}
      tabIndex={interactive ? 0 : -1}
    >
      <span className={styles.projectMark}>B</span>
      <span className={styles.projectName}>BlameDemo</span>
      <ChevronDown aria-hidden="true" />
    </button>
  );
}

function NavigationGroup({
  interactive,
  items,
  label,
}: {
  interactive: boolean;
  items: ShellNavigationItem[];
  label: string;
}) {
  return (
    <div className={styles.navigationGroup}>
      <p className={styles.navigationLabel}>{label}</p>
      <NavigationItems items={items} interactive={interactive} />
    </div>
  );
}

function NavigationItems({
  className,
  interactive,
  items,
}: {
  className?: string;
  interactive: boolean;
  items: ShellNavigationItem[];
}) {
  return (
    <div className={className}>
      {items.map((item) => (
        <NavigationButton
          key={item.label}
          item={item}
          interactive={interactive}
        />
      ))}
    </div>
  );
}

function NavigationButton({
  interactive,
  item,
}: {
  interactive: boolean;
  item: ShellNavigationItem;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      aria-current={item.active ? "page" : undefined}
      className={styles.navigationButton}
      disabled={!interactive}
      tabIndex={interactive ? 0 : -1}
    >
      <Icon aria-hidden="true" />
      <span>{item.label}</span>
    </button>
  );
}

function UserProfile({ interactive }: { interactive: boolean }) {
  return (
    <button
      type="button"
      className={styles.userProfile}
      disabled={!interactive}
      tabIndex={interactive ? 0 : -1}
    >
      <span className={styles.userAvatar}>RA</span>
      <span className={styles.userDetails}>
        <strong>Raphael</strong>
        <small>hello@world.com</small>
      </span>
      <MoreVertical aria-hidden="true" />
    </button>
  );
}

function AppHeader({ interactive }: { interactive: boolean }) {
  return (
    <header className={styles.appHeader}>
      <ShellControl label="Toggle sidebar" interactive={interactive}>
        <PanelLeft />
      </ShellControl>
      <span className={styles.headerDivider} />
      <strong>Backlog</strong>
      <div className={styles.runnerControls}>
        <span className={styles.runnerStatus} />
        <span>Web application</span>
        <ChevronDown aria-hidden="true" />
        <ShellControl label="Run project" interactive={interactive}>
          <Play />
        </ShellControl>
        <ShellControl label="Stop project" interactive={interactive}>
          <Square />
        </ShellControl>
        <ShellControl label="Open terminal" interactive={interactive}>
          <Terminal />
        </ShellControl>
      </div>
    </header>
  );
}

function ShellControl({
  children,
  interactive,
  label,
}: {
  children: ReactNode;
  interactive: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={styles.shellControl}
      disabled={!interactive}
      tabIndex={interactive ? 0 : -1}
    >
      {children}
    </button>
  );
}
