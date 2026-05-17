import type { FileContent, VcsFileDiff } from "@opencode-ai/sdk/v2"
import { FileIcon, GitPullRequestIcon, XIcon } from "lucide-react"

import { DevelopmentFileView } from "@/components/backlog/development/development-file-view"
import { DevelopmentReview } from "@/components/backlog/development/development-review"
import {
  filename,
  type DevelopmentFileTab,
} from "@/components/backlog/development/development-workspace"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"

export function DevelopmentTabs({
  activeTab,
  diffByPath,
  diffs,
  mode,
  onActiveTabChange,
  onCloseTab,
  onOpenFile,
  readFile,
  reloadKey,
  reviewLoading,
  tabs,
}: {
  activeTab: string
  diffByPath: Map<string, VcsFileDiff>
  diffs: VcsFileDiff[]
  mode: "files" | "diff"
  onActiveTabChange: (tab: string) => void
  onCloseTab: (path: string) => void
  onOpenFile: (path: string) => void
  readFile: (path: string) => Promise<FileContent | undefined>
  reloadKey: number
  reviewLoading: boolean
  tabs: DevelopmentFileTab[]
}) {
  const active = activeTab || (mode === "diff" ? "review" : "empty")

  return (
    <Tabs
      className="h-full min-h-0 gap-0"
      value={active}
      onValueChange={onActiveTabChange}
    >
      <div className="flex shrink-0 items-center border-b bg-background">
        <ScrollArea className="min-w-0 flex-1">
          <TabsList className="overflow-y-hidden" variant="line">
            {mode === "diff" && (
              <TabsTrigger value="review">
                <GitPullRequestIcon className="size-4" />
                Review
                {diffs.length > 0 && <span className="text-xs">{diffs.length}</span>}
              </TabsTrigger>
            )}
            {tabs.map((tab) => (
              <TabsTrigger key={tab.path} value={tab.path}>
                <FileIcon className="size-4" />
                <span className="max-w-40 truncate">{filename(tab.path)}</span>
                <span
                  className="ml-1 inline-flex size-5 items-center justify-center rounded-md hover:bg-muted"
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation()
                    onCloseTab(tab.path)
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return
                    event.preventDefault()
                    event.stopPropagation()
                    onCloseTab(tab.path)
                  }}
                >
                  <XIcon className="size-3" />
                  <span className="sr-only">Close tab</span>
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </ScrollArea>
      </div>
      {mode === "diff" && (
        <TabsContent className="min-h-0" value="review">
          <DevelopmentReview
            diffs={diffs}
            loading={reviewLoading}
            onOpenFile={onOpenFile}
          />
        </TabsContent>
      )}
      <TabsContent className="min-h-0" value="empty">
        <EmptyTabs />
      </TabsContent>
      {tabs.map((tab) => (
        <TabsContent className="min-h-0" key={tab.path} value={tab.path}>
          <DevelopmentFileView
            diff={diffByPath.get(tab.path)}
            path={tab.path}
            readFile={readFile}
            reloadKey={reloadKey}
          />
        </TabsContent>
      ))}
    </Tabs>
  )
}

function EmptyTabs() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
      Select a file to open it.
    </div>
  )
}
