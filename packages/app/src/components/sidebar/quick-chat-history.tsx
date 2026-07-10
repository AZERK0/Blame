import * as React from "react"
import { XIcon } from "lucide-react"
import { toast } from "sonner"

import {
  quickChatSelectedEvent,
  type QuickChat,
} from "@/components/chat/data/quick-chat-data"
import { useQuickChatStore } from "@/components/chat/data/quick-chat-store"
import { AppLink } from "@/components/navigation/app-link"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"

const chatPageSize = 5

export function QuickChatHistory() {
  const quickChats = useQuickChatStore()
  const [pagination, setPagination] = React.useState({
    count: chatPageSize,
    projectId: quickChats.projectId,
  })
  const [chatToDelete, setChatToDelete] = React.useState<QuickChat | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const chats = React.useMemo(
    () => [...quickChats.chats].sort(compareChatsByMostRecent),
    [quickChats.chats]
  )
  const visibleCount =
    pagination.projectId === quickChats.projectId
      ? pagination.count
      : chatPageSize
  const visibleChats = chats.slice(0, visibleCount)

  function setVisibleCount(update: (current: number) => number) {
    setPagination({
      count: update(visibleCount),
      projectId: quickChats.projectId,
    })
  }

  async function deleteChat() {
    if (!chatToDelete || deleting) return
    setDeleting(true)
    try {
      await quickChats.remove(chatToDelete)
      setChatToDelete(null)
    } catch (error) {
      toast.error("Unable to delete quick chat", {
        description:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred.",
        position: "bottom-right",
      })
    } finally {
      setDeleting(false)
    }
  }

  if (!quickChats.loading && !chats.length) return null

  return (
    <>
      <SidebarMenuSub className="gap-0.5 pb-1">
        {quickChats.loading && !chats.length ? (
          <SidebarMenuSubItem className="px-2 py-1 text-xs text-muted-foreground">
            Loading chats…
          </SidebarMenuSubItem>
        ) : null}
        {visibleChats.map((chat) => (
          <SidebarMenuSubItem className="group/chat" key={chat.id}>
            <SidebarMenuButton
              asChild
              className="h-7 pr-11 pl-2 text-xs"
              isActive={quickChats.activeId === chat.id}
              size="sm"
              tooltip={chat.title}
            >
              <AppLink
                href="/chats"
                onClick={() => {
                  quickChats.setActiveId(chat.id)
                  window.dispatchEvent(new Event(quickChatSelectedEvent))
                }}
              >
                <span className="truncate">{chat.title}</span>
              </AppLink>
            </SidebarMenuButton>
            <time
              className={`pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px] leading-none text-muted-foreground tabular-nums transition-opacity ${
                chat.agentStatus === "Running"
                  ? ""
                  : "group-focus-within/chat:opacity-0 group-hover/chat:opacity-0"
              }`}
              dateTime={chat.updatedAt ?? chat.createdAt}
              title={exactTimeLabel(chat.updatedAt ?? chat.createdAt)}
            >
              {relativeTimeLabel(chat.updatedAt ?? chat.createdAt)}
            </time>
            {chat.agentStatus !== "Running" ? (
              <button
                aria-label={`Delete ${chat.title}`}
                className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity outline-none group-focus-within/chat:opacity-100 group-hover/chat:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                onClick={() => setChatToDelete(chat)}
                title={`Delete ${chat.title}`}
                type="button"
              >
                <XIcon className="size-3.5" />
              </button>
            ) : null}
          </SidebarMenuSubItem>
        ))}
        {chats.length > chatPageSize ? (
          <SidebarMenuSubItem className="flex items-center gap-1 px-1 pt-1">
            {visibleCount < chats.length ? (
              <button
                className="rounded px-1.5 py-1 text-[11px] font-medium text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                onClick={() =>
                  setVisibleCount((current) =>
                    Math.min(current + chatPageSize, chats.length)
                  )
                }
                type="button"
              >
                Show more
              </button>
            ) : null}
            {visibleCount > chatPageSize ? (
              <button
                className="rounded px-1.5 py-1 text-[11px] font-medium text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                onClick={() =>
                  setVisibleCount((current) =>
                    Math.max(chatPageSize, current - chatPageSize)
                  )
                }
                type="button"
              >
                Show less
              </button>
            ) : null}
          </SidebarMenuSubItem>
        ) : null}
      </SidebarMenuSub>
      <AlertDialog
        open={Boolean(chatToDelete)}
        onOpenChange={(open) => {
          if (!open && !deleting) setChatToDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <XIcon />
            </AlertDialogMedia>
            <AlertDialogTitle>Delete conversation</AlertDialogTitle>
            <AlertDialogDescription>
              Delete “{chatToDelete?.title}” permanently? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault()
                void deleteChat()
              }}
              variant="destructive"
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function compareChatsByMostRecent(left: QuickChat, right: QuickChat) {
  return chatTimestamp(right) - chatTimestamp(left)
}

function chatTimestamp(chat: QuickChat) {
  return new Date(chat.updatedAt ?? chat.createdAt).getTime() || 0
}

function relativeTimeLabel(value: string) {
  const diffMs = Date.now() - new Date(value).getTime()
  if (Number.isNaN(diffMs) || diffMs < 60_000) return "now"
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function exactTimeLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}
