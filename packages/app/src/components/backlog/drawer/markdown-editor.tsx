import * as React from "react"
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  headingsPlugin,
  listsPlugin,
  ListsToggle,
  markdownShortcutPlugin,
  MDXEditor,
  type MDXEditorMethods,
  quotePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  UndoRedo,
} from "@mdxeditor/editor"
import { PaperclipIcon, SparklesIcon, Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  codeSelectionLineLabel,
  type PendingCodeSelectionAttachment,
} from "@/components/backlog/shared/comment-attachment-events"
import { DevelopmentFileIcon } from "@/components/backlog/development/development-file-icon"
import { useServer } from "@/context/server"
import { createSdkForServer } from "@/lib/opencode-client"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"

type PastedAttachment = {
  id: string
  file: File
  previewUrl?: string
  subtitle?: string
  title?: string
}

type FileMentionState = {
  active: boolean
  query: string
  start: number
  end: number
}

type FileMentionResult = {
  path: string
  type: "directory" | "file"
}

function fileAttachments(files: File[]) {
  return files.map((file) => ({
    id: crypto.randomUUID(),
    file,
    previewUrl: file.type.startsWith("image/")
      ? URL.createObjectURL(file)
      : undefined,
  }))
}

function pastedAttachments(event: React.ClipboardEvent<HTMLDivElement>) {
  return fileAttachments(
    Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))
  )
}

function selectedAttachments(event: React.ChangeEvent<HTMLInputElement>) {
  return fileAttachments(
    Array.from(event.currentTarget.files ?? []).filter((file): file is File =>
      Boolean(file)
    )
  )
}

function textLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? "").replace(/\u200B/g, "").length
  }
  if (
    node.nodeType === Node.ELEMENT_NODE &&
    (node as HTMLElement).tagName === "BR"
  )
    return 1
  return Array.from(node.childNodes).reduce(
    (total, child) => total + textLength(child),
    0
  )
}

function cursorPosition(parent: HTMLElement) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return 0
  const range = selection.getRangeAt(0)
  if (!parent.contains(range.startContainer)) return 0
  const beforeCursor = range.cloneRange()
  beforeCursor.selectNodeContents(parent)
  beforeCursor.setEnd(range.startContainer, range.startOffset)
  return textLength(beforeCursor.cloneContents())
}

function editorText(parent: HTMLElement) {
  return Array.from(parent.childNodes)
    .map((node) => nodeText(node))
    .join("")
}

function nodeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE)
    return (node.textContent ?? "").replace(/\u200B/g, "")
  if (
    node.nodeType === Node.ELEMENT_NODE &&
    (node as HTMLElement).tagName === "BR"
  )
    return "\n"
  return Array.from(node.childNodes)
    .map((child) => nodeText(child))
    .join("")
}

function setRangeEdge(
  parent: HTMLElement,
  range: Range,
  edge: "start" | "end",
  offset: number
) {
  const position = rangePosition(parent, offset)
  if (!position) return
  if (edge === "start") range.setStart(position.node, position.offset)
  if (edge === "end") range.setEnd(position.node, position.offset)
}

function setCursorPosition(parent: HTMLElement, offset: number) {
  const position = rangePosition(parent, offset)
  if (!position) return
  const range = document.createRange()
  const selection = window.getSelection()
  parent.focus()
  range.setStart(position.node, position.offset)
  range.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function insertTextAtRange(editor: HTMLElement, range: Range, value: string) {
  const selection = window.getSelection()
  if (!selection) return false
  const before = editorText(editor)
  editor.focus()
  selection.removeAllRanges()
  selection.addRange(range)
  if (
    typeof document.execCommand === "function" &&
    document.execCommand("insertText", false, value) &&
    editorText(editor) !== before
  )
    return true
  range.deleteContents()
  const text = document.createTextNode(value)
  range.insertNode(text)
  range.setStartAfter(text)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
  editor.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      data: value,
      inputType: "insertText",
    })
  )
  return true
}

function rangePosition(
  node: Node,
  offset: number
): { node: Node; offset: number } | undefined {
  if (node.nodeType === Node.TEXT_NODE) {
    return { node, offset: Math.min(offset, node.textContent?.length ?? 0) }
  }

  if (
    node.nodeType === Node.ELEMENT_NODE &&
    (node as HTMLElement).tagName === "BR"
  ) {
    return {
      node: node.parentNode ?? node,
      offset:
        Array.from(node.parentNode?.childNodes ?? []).indexOf(node) +
        (offset > 0 ? 1 : 0),
    }
  }

  let remaining = offset
  for (const child of Array.from(node.childNodes)) {
    const length = textLength(child)
    if (remaining <= length) return rangePosition(child, remaining)
    remaining -= length
  }

  if (node.lastChild)
    return rangePosition(node.lastChild, textLength(node.lastChild))
  return { node, offset: 0 }
}

function fileMentionState(editor: HTMLElement): FileMentionState {
  const cursor = cursorPosition(editor)
  const match = editorText(editor)
    .substring(0, cursor)
    .match(/@(\S*)$/)
  return match
    ? {
        active: true,
        query: match[1] ?? "",
        start: match.index ?? cursor - match[0].length,
        end: cursor,
      }
    : { active: false, query: "", start: 0, end: cursor }
}

function filename(path: string) {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "")
  return normalized.split("/").at(-1) || normalized
}

function directoryName(path: string) {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "")
  const index = normalized.lastIndexOf("/")
  return index === -1 ? "" : `${normalized.slice(0, index)}/`
}

function AttachmentDeleteButton({
  attachment,
  onRemove,
}: {
  attachment: PastedAttachment
  onRemove: (attachment: PastedAttachment) => void
}) {
  return (
    <Button
      type="button"
      aria-label={`Remove ${attachment.file.name}`}
      className="absolute -top-2 -right-2 size-6 opacity-0 shadow-sm group-hover:opacity-100 focus-visible:opacity-100"
      size="icon-xs"
      variant="destructive"
      onClick={() => onRemove(attachment)}
    >
      <Trash2Icon className="size-3" />
    </Button>
  )
}

function AttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: PastedAttachment
  onRemove: (attachment: PastedAttachment) => void
}) {
  if (attachment.previewUrl) {
    return (
      <ImageAttachmentPreview attachment={attachment} onRemove={onRemove} />
    )
  }

  return <FileAttachmentPreview attachment={attachment} onRemove={onRemove} />
}

function ImageAttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: PastedAttachment & { previewUrl: string }
  onRemove: (attachment: PastedAttachment) => void
}) {
  return (
    <div className="group relative">
      <Dialog>
        <DialogTrigger asChild>
          <button
            type="button"
            className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border bg-muted/30 transition-colors outline-none hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <img
              alt={attachment.file.name}
              className="h-full w-full object-cover"
              src={attachment.previewUrl}
            />
          </button>
        </DialogTrigger>
        <DialogContent className="max-w-[calc(100%-2rem)] p-2 sm:max-w-4xl">
          <DialogTitle className="sr-only">{attachment.file.name}</DialogTitle>
          <img
            alt={attachment.file.name}
            className="max-h-[80vh] w-full rounded-lg object-contain"
            src={attachment.previewUrl}
          />
        </DialogContent>
      </Dialog>
      <AttachmentDeleteButton attachment={attachment} onRemove={onRemove} />
    </div>
  )
}

function FileAttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: PastedAttachment
  onRemove: (attachment: PastedAttachment) => void
}) {
  return (
    <div className="group relative">
      <div className="flex h-16 w-16 items-center justify-center rounded-md border bg-muted/30 px-2 text-center text-[0.625rem] leading-tight text-muted-foreground">
        <span className="line-clamp-3 break-all">
          {attachment.title ?? attachment.file.name}
          {attachment.subtitle && (
            <span className="mt-1 block text-[0.55rem] text-muted-foreground/80">
              {attachment.subtitle}
            </span>
          )}
        </span>
      </div>
      <AttachmentDeleteButton attachment={attachment} onRemove={onRemove} />
    </div>
  )
}

const markdownPlugins = [
  headingsPlugin(),
  listsPlugin(),
  quotePlugin(),
  thematicBreakPlugin(),
  markdownShortcutPlugin(),
  toolbarPlugin({
    toolbarContents: () => (
      <>
        <UndoRedo />
        <BlockTypeSelect />
        <BoldItalicUnderlineToggles />
        <ListsToggle />
        <span className="flex-1" />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 border-blue-500/40! bg-blue-500/10! px-2 text-xs text-blue-700 hover:bg-blue-500/20 dark:text-blue-300"
        >
          <SparklesIcon className="size-3.5 text-blue-700! dark:text-blue-300!" />
          Optimize with AI
        </Button>
      </>
    ),
  }),
]

const readOnlyMarkdownPlugins = [
  headingsPlugin(),
  listsPlugin(),
  quotePlugin(),
  thematicBreakPlugin(),
  markdownShortcutPlugin(),
]

export const MarkdownEditor = React.forwardRef<
  HTMLDivElement,
  {
    markdown: string
    minHeight: string
    placeholder: string
    codeSelectionAttachments?: PendingCodeSelectionAttachment[]
    mentionDirectory?: string
    onMarkdownChange?: (markdown: string) => void
    readOnly?: boolean
  }
>(function MarkdownEditor(
  {
    codeSelectionAttachments,
    markdown,
    mentionDirectory,
    minHeight,
    onMarkdownChange,
    placeholder,
    readOnly,
  },
  ref
) {
  const server = useServer()
  const [attachments, setAttachments] = React.useState<PastedAttachment[]>([])
  const [mention, setMention] = React.useState<FileMentionState>({
    active: false,
    query: "",
    start: 0,
    end: 0,
  })
  const [mentionResults, setMentionResults] = React.useState<
    FileMentionResult[]
  >([])
  const [activeMentionIndex, setActiveMentionIndex] = React.useState(0)
  const attachmentsRef = React.useRef<PastedAttachment[]>([])
  const editorRef = React.useRef<MDXEditorMethods>(null)
  const contentEditableRef = React.useRef<HTMLElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const handledCodeSelectionIdsRef = React.useRef(new Set<string>())
  const insertingMentionRef = React.useRef(false)
  const mentionSearchRef = React.useRef(0)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const client = React.useMemo(
    () => (server.server ? createSdkForServer(server.server) : undefined),
    [server.server]
  )
  const mentionOpen =
    mention.active && !readOnly && Boolean(client) && Boolean(mentionDirectory)

  React.useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  React.useEffect(() => {
    if (!mentionOpen) return

    const search = ++mentionSearchRef.current
    const timer = setTimeout(async () => {
      try {
        const result = await client?.find.files({
          directory: mentionDirectory,
          query: mention.query,
          dirs: "true",
          limit: 10,
        })
        if (search !== mentionSearchRef.current) return
        setMentionResults(
          (result?.data ?? []).map((path) => ({
            path,
            type: path.endsWith("/") ? "directory" : "file",
          }))
        )
        setActiveMentionIndex(0)
      } catch {
        if (search !== mentionSearchRef.current) return
        setMentionResults([])
        setActiveMentionIndex(0)
      }
    }, 80)

    return () => clearTimeout(timer)
  }, [client, mention.query, mentionDirectory, mentionOpen])

  React.useEffect(() => {
    if (mentionOpen) return
    mentionSearchRef.current += 1
  }, [mentionOpen])

  React.useEffect(() => {
    const frame = requestAnimationFrame(() => {
      contentEditableRef.current =
        rootRef.current?.querySelector<HTMLElement>(
          "[contenteditable='true']"
        ) ?? null
    })
    return () => cancelAnimationFrame(frame)
  })

  React.useEffect(
    () => () => {
      attachmentsRef.current.forEach((attachment) => {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
      })
    },
    []
  )

  function updateMention() {
    if (insertingMentionRef.current) return
    const editor = contentEditableRef.current
    if (!editor || readOnly || !client || !mentionDirectory) {
      setMention((current) =>
        current.active
          ? { active: false, query: "", start: 0, end: 0 }
          : current
      )
      return
    }
    setMention(fileMentionState(editor))
  }

  React.useEffect(() => {
    if (readOnly) return
    const nextAttachments = (codeSelectionAttachments ?? [])
      .filter(
        (attachment) => !handledCodeSelectionIdsRef.current.has(attachment.id)
      )
      .map(codeSelectionAttachment)
    if (nextAttachments.length === 0) return
    codeSelectionAttachments?.forEach((attachment) => {
      handledCodeSelectionIdsRef.current.add(attachment.id)
    })
    addAttachments(nextAttachments)
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [codeSelectionAttachments, readOnly])

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!mentionOpen) return
    if (event.key === "Escape") {
      closeMention()
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.key === "ArrowDown") {
      setActiveMentionIndex((index) =>
        mentionResults.length === 0 ? 0 : (index + 1) % mentionResults.length
      )
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.key === "ArrowUp") {
      setActiveMentionIndex((index) =>
        mentionResults.length === 0
          ? 0
          : (index - 1 + mentionResults.length) % mentionResults.length
      )
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.key === "Enter" || event.key === "Tab") {
      selectMention(mentionResults[activeMentionIndex])
      event.preventDefault()
      event.stopPropagation()
    }
  }

  function closeMention() {
    setMention({ active: false, query: "", start: 0, end: 0 })
    setMentionResults([])
    setActiveMentionIndex(0)
  }

  function selectMention(result?: FileMentionResult) {
    const editor = contentEditableRef.current
    if (!editor || !result) return
    const insertedPath = `${result.path} `
    insertingMentionRef.current = true

    if (mention.start === 0) {
      const suffix = editorText(editor).slice(mention.end)
      editorRef.current?.setMarkdown(
        suffix ? `${insertedPath}${suffix}` : `${insertedPath}\u200B`
      )
      closeMention()
      requestAnimationFrame(() => {
        editorRef.current?.focus()
        requestAnimationFrame(() => {
          if (contentEditableRef.current) {
            setCursorPosition(contentEditableRef.current, insertedPath.length)
          }
          insertingMentionRef.current = false
          updateMention()
        })
      })
      return
    }

    const selection = window.getSelection()
    const range = document.createRange()
    if (!selection) return
    setRangeEdge(editor, range, "start", mention.start)
    setRangeEdge(editor, range, "end", mention.end)
    insertTextAtRange(editor, range, insertedPath)
    closeMention()
    requestAnimationFrame(() => {
      editorRef.current?.focus()
      insertingMentionRef.current = false
      updateMention()
    })
  }

  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    if (readOnly) return
    const nextAttachments = pastedAttachments(event)
    if (nextAttachments.length === 0) return
    addAttachments(nextAttachments)
  }

  function handleFileSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const nextAttachments = selectedAttachments(event)
    event.currentTarget.value = ""
    if (nextAttachments.length === 0) return
    addAttachments(nextAttachments)
  }

  function addAttachments(nextAttachments: PastedAttachment[]) {
    setAttachments((currentAttachments) => [
      ...currentAttachments,
      ...nextAttachments,
    ])
  }

  function removeAttachment(attachment: PastedAttachment) {
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
    setAttachments((currentAttachments) =>
      currentAttachments.filter(
        (currentAttachment) => currentAttachment.id !== attachment.id
      )
    )
  }

  return (
    <Popover open={mentionOpen}>
      <PopoverAnchor asChild>
        <div
          ref={(element) => {
            rootRef.current = element
            if (typeof ref === "function") ref(element)
            else if (ref) ref.current = element
          }}
          className="overflow-hidden rounded-lg border border-input bg-transparent transition-colors focus-within:border-ring dark:bg-input/30"
          onBlur={() => requestAnimationFrame(updateMention)}
          onInput={updateMention}
          onKeyDownCapture={handleKeyDown}
          onKeyUp={updateMention}
          onPaste={handlePaste}
        >
          <MDXEditor
            ref={editorRef}
            className="user-story-mdx-editor"
            contentEditableClassName={`${minHeight} px-3 py-3 text-sm`}
            markdown={markdown}
            placeholder={placeholder}
            plugins={readOnly ? readOnlyMarkdownPlugins : markdownPlugins}
            readOnly={readOnly}
            onChange={(nextMarkdown) => {
              updateMention()
              onMarkdownChange?.(nextMarkdown)
            }}
          />

          <div className="flex items-center gap-3 p-4">
            {!readOnly && (
              <>
                <input
                  ref={fileInputRef}
                  className="hidden"
                  multiple
                  type="file"
                  onChange={handleFileSelection}
                />
                {attachments.map((attachment) => (
                  <AttachmentPreview
                    key={attachment.id}
                    attachment={attachment}
                    onRemove={removeAttachment}
                  />
                ))}
                <Button
                  type="button"
                  variant="outline"
                  className="flex h-16 w-16 flex-col gap-2 p-5"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <PaperclipIcon className="size-5" />
                </Button>
              </>
            )}
          </div>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[min(36rem,calc(100vw-2rem))] p-0"
        onCloseAutoFocus={(event) => event.preventDefault()}
        onMouseDown={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => event.preventDefault()}
        side="top"
        sideOffset={8}
      >
        <Command shouldFilter={false}>
          <CommandList className="max-h-72">
            <CommandEmpty className="py-3 text-muted-foreground">
              No matching files.
            </CommandEmpty>
            <CommandGroup>
              {mentionResults.map((result, index) => (
                <CommandItem
                  key={result.path}
                  value={result.path}
                  className={`gap-2 ${index === activeMentionIndex ? "bg-muted text-foreground" : ""}`}
                  onMouseEnter={() => setActiveMentionIndex(index)}
                  onSelect={() => selectMention(result)}
                >
                  <DevelopmentFileIcon className="shrink-0" node={result} />
                  <span className="flex min-w-0 items-center text-sm">
                    <span className="truncate text-muted-foreground">
                      {directoryName(result.path)}
                    </span>
                    <span className="shrink-0 text-foreground">
                      {filename(result.path)}
                      {result.type === "directory" ? "/" : ""}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
})

function codeSelectionAttachment(
  attachment: PendingCodeSelectionAttachment
): PastedAttachment {
  return {
    id: attachment.id,
    file: new File([attachment.content], attachment.path, {
      type: "text/plain",
    }),
    subtitle: codeSelectionLineLabel(attachment),
    title: attachment.path,
  }
}
