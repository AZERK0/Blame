import * as React from "react"
import type { AgentApprovalRequest, AgentEvent, ApprovalDecision } from "@blame/agent-runtime"
import { LoaderCircleIcon, RotateCcwIcon, SendIcon, SquareIcon } from "lucide-react"

import { ModelSelector, useModelSelection } from "@/components/model/model-selector"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useCloudAuth } from "@/context/cloud-auth"
import { usePlatform } from "@/context/platform"
import { useProjects } from "@/context/projects"

export function QuickChatPage() {
  const auth = useCloudAuth()
  const platform = usePlatform()
  const projects = useProjects()
  const selection = useModelSelection()
  const [prompt, setPrompt] = React.useState("")
  const [lastPrompt, setLastPrompt] = React.useState("")
  const [sessionId, setSessionId] = React.useState<string>()
  const [events, setEvents] = React.useState<AgentEvent[]>([])
  const [running, setRunning] = React.useState(false)
  const [error, setError] = React.useState<string>()

  React.useEffect(() => {
    if (!sessionId || !platform.agent) return
    return platform.agent.sessions.onEvent(sessionId, (event) => {
      setEvents((current) => [...current, event])
      if (event.type === "done" || event.type === "error") setRunning(false)
      if (event.type === "error") setError(eventText(event.payload) || "Agent session failed")
    })
  }, [platform.agent, sessionId])

  const submit = async (inputPrompt = prompt) => {
    if (!platform.agent || !selection.currentModel || !projects.activeProject || auth.status !== "authenticated") return
    setRunning(true)
    setError(undefined)
    setLastPrompt(inputPrompt)
    setPrompt("")
    try {
      if (sessionId) {
        await platform.agent.sessions.send({ sessionId, prompt: inputPrompt })
        return
      }
      const session = await startSession(inputPrompt)
      setEvents([])
      setSessionId(session.sessionId)
    } catch (error) {
      setRunning(false)
      setError(error instanceof Error ? error.message : "Unable to start agent session")
      setPrompt(inputPrompt)
    }
  }

  const abort = async () => {
    if (!sessionId || !platform.agent) return
    await platform.agent.sessions.abort(sessionId)
    setRunning(false)
  }

  const resolveApproval = async (request: AgentApprovalRequest, decision: ApprovalDecision) => {
    if (!platform.agent) return
    await platform.agent.approvals.resolve({ requestId: request.id, decision })
  }

  const startSession = (inputPrompt: string) => {
    if (!platform.agent || !selection.currentModel || !projects.activeProject || auth.status !== "authenticated") {
      throw new Error("Agent runtime is not ready")
    }
    return platform.agent.sessions.start({
      apiConnection: auth.apiConnection,
      providerId: selection.currentModel.provider.id,
      modelId: selection.currentModel.id,
      prompt: inputPrompt,
      cwd: projects.activeProject.path,
      workspaceRoot: projects.activeProject.path,
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold">Quick Chat</h2>
          <p className="text-sm text-muted-foreground">Start a Cline SDK session in the active project.</p>
        </div>
        <ModelSelector />
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card p-4 text-sm">
        {error ? <p className="mb-3 text-destructive">{error}</p> : null}
        {events.length ? (
          <div className="grid gap-3">
            {events.map((event, index) => (
              <QuickChatEvent
                key={`${event.type}-${index}`}
                event={event}
                onResolveApproval={resolveApproval}
              />
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">No session output yet.</p>
        )}
      </div>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <Textarea
          value={prompt}
          placeholder="Ask Blame to inspect, explain, or change the active project."
          onChange={(event) => setPrompt(event.currentTarget.value)}
        />
        <div className="flex justify-end gap-2">
          {!running && lastPrompt ? (
            <Button type="button" variant="outline" onClick={() => void submit(lastPrompt)}>
              <RotateCcwIcon />
              Retry
            </Button>
          ) : null}
          {running ? (
            <Button type="button" variant="outline" onClick={() => void abort()}>
              <SquareIcon />
              Stop
            </Button>
          ) : null}
          <Button type="submit" disabled={running || !prompt.trim() || !selection.currentModel}>
            {running ? <LoaderCircleIcon className="animate-spin" /> : <SendIcon />}
            Send
          </Button>
        </div>
      </form>
    </div>
  )
}

function QuickChatEvent({
  event,
  onResolveApproval,
}: {
  event: AgentEvent
  onResolveApproval(request: AgentApprovalRequest, decision: ApprovalDecision): Promise<void>
}) {
  if (event.type === "text") return <p className="whitespace-pre-wrap">{eventText(event.payload)}</p>
  if (event.type === "approval") {
    const request = event.payload as AgentApprovalRequest
    return (
      <div className="grid gap-3 rounded-md border p-3">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">Approval</Badge>
          <span className="font-medium">{request.toolName}</span>
        </div>
        {request.reason ? <p className="text-muted-foreground">{request.reason}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void onResolveApproval(request, "approve")}>
            Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => void onResolveApproval(request, "always")}>
            Always allow
          </Button>
          <Button size="sm" variant="destructive" onClick={() => void onResolveApproval(request, "deny")}>
            Deny
          </Button>
        </div>
      </div>
    )
  }
  if (event.type === "tool") {
    const payload = event.payload as { hookEventName?: string; toolName?: string }
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Badge variant="outline">{payload.hookEventName ?? "tool"}</Badge>
        <span>{payload.toolName ?? "tool"}</span>
      </div>
    )
  }
  return <p className="text-muted-foreground">{eventText(event.payload) || event.type}</p>
}

function eventText(payload: unknown) {
  if (!payload || typeof payload !== "object") return ""
  if ("text" in payload && typeof payload.text === "string") return payload.text
  if ("delta" in payload && typeof payload.delta === "string") return payload.delta
  if ("content" in payload && typeof payload.content === "string") return payload.content
  return ""
}
