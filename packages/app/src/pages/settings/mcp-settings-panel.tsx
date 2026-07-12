import * as React from "react"
import {
  AlertCircleIcon,
  ChevronDownIcon,
  KeyRoundIcon,
  PlusIcon,
  ServerIcon,
  Trash2Icon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  usePlatform,
  type McpServerConfig,
  type McpTransport,
} from "@/context/platform"

type Entry = { id: string; key: string; value: string }
type FormState = {
  args: string
  command: string
  cwd: string
  entries: Entry[]
  name: string
  transport: McpTransport
  url: string
}

const emptyForm = (): FormState => ({
  args: "",
  command: "",
  cwd: "",
  entries: [],
  name: "",
  transport: "stdio",
  url: "",
})

export function McpSettingsPanel() {
  const client = usePlatform().mcp
  const [servers, setServers] = React.useState<McpServerConfig[]>([])
  const [adding, setAdding] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string>()

  React.useEffect(() => {
    if (!client) {
      setLoading(false)
      return
    }
    void client
      .list()
      .then(setServers)
      .catch((reason) => setError(errorMessage(reason)))
      .finally(() => setLoading(false))
  }, [client])

  async function update(action: () => Promise<McpServerConfig[]>) {
    setError(undefined)
    try {
      setServers(await action())
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }

  return (
    <div className="flex flex-col gap-5 py-6">
      <section>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold">Server connections</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Give Blame agents access to external tools and context.
            </p>
          </div>
          <Button
            type="button"
            disabled={!client || adding}
            onClick={() => setAdding(true)}
          >
            <PlusIcon />
            Add server
          </Button>
        </div>

        {!client && (
          <Notice>
            Server connections are available in the Blame desktop app.
          </Notice>
        )}
        {error && <Notice error>{error}</Notice>}
        {adding && client && (
          <McpServerForm
            onCancel={() => setAdding(false)}
            onSave={async (server) => {
              await update(() => client.save(server))
              setAdding(false)
            }}
          />
        )}

        <div className="mt-5 grid gap-3">
          {loading && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Loading servers…
            </p>
          )}
          {!loading && client && servers.length === 0 && !adding && (
            <div className="rounded-xl border border-dashed px-5 py-10 text-center">
              <ServerIcon className="mx-auto size-6 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">No MCP servers added</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Connect one to make its tools available during agent work.
              </p>
            </div>
          )}
          {servers.map((server) => (
            <McpServerCard
              key={server.name}
              server={server}
              onToggle={(enabled) =>
                client && update(() => client.setEnabled(server.name, enabled))
              }
              onRemove={() =>
                client && update(() => client.remove(server.name))
              }
              onAuthorize={() =>
                client
                  ? update(() => client.authorize(server.name))
                  : Promise.resolve()
              }
              onDisconnectOAuth={() =>
                client
                  ? update(() => client.disconnectOAuth(server.name))
                  : Promise.resolve()
              }
            />
          ))}
        </div>
      </section>
    </div>
  )
}

function McpServerCard({
  server,
  onAuthorize,
  onDisconnectOAuth,
  onRemove,
  onToggle,
}: {
  server: McpServerConfig
  onAuthorize(): Promise<void>
  onDisconnectOAuth(): Promise<void>
  onRemove(): void
  onToggle(enabled: boolean): void
}) {
  const [authorizing, setAuthorizing] = React.useState(false)
  const endpoint =
    server.transport === "stdio"
      ? [server.command, ...(server.args ?? [])].join(" ")
      : server.url
  return (
    <Card size="sm">
      <CardContent className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <ServerIcon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{server.name}</p>
            <Badge variant={server.disabled ? "outline" : "secondary"}>
              {server.disabled ? "Disabled" : "Ready"}
            </Badge>
          </div>
          <p
            className="mt-1 truncate font-mono text-xs text-muted-foreground"
            title={endpoint}
          >
            {endpoint}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{transportLabel(server.transport)}</span>
            {server.oauth.supported && (
              <span>
                ·{" "}
                {server.oauth.configured
                  ? "OAuth connected"
                  : "OAuth available"}
              </span>
            )}
          </div>
          {server.oauth.lastError && (
            <p className="mt-1 text-xs text-destructive">
              {server.oauth.lastError}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 self-end sm:self-auto">
          {server.oauth.supported && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={server.disabled || authorizing}
              onClick={async () => {
                setAuthorizing(true)
                try {
                  if (server.oauth.configured) await onDisconnectOAuth()
                  else await onAuthorize()
                } finally {
                  setAuthorizing(false)
                }
              }}
            >
              <KeyRoundIcon />
              {authorizing
                ? "Waiting…"
                : server.oauth.configured
                  ? "Disconnect"
                  : "Connect"}
            </Button>
          )}
          <Switch
            checked={!server.disabled}
            aria-label={`Enable ${server.name} MCP server`}
            onCheckedChange={onToggle}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${server.name}`}
            onClick={onRemove}
          >
            <Trash2Icon />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function McpServerForm({
  onCancel,
  onSave,
}: {
  onCancel(): void
  onSave(server: McpServerConfig): Promise<void>
}) {
  const [form, setForm] = React.useState(emptyForm)
  const [advanced, setAdvanced] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string>()
  const firstInput = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => firstInput.current?.focus(), [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(undefined)
    setSaving(true)
    const pairs = Object.fromEntries(
      form.entries
        .filter((entry) => entry.key.trim())
        .map((entry) => [entry.key.trim(), entry.value])
    )
    const server: McpServerConfig =
      form.transport === "stdio"
        ? {
            name: form.name,
            oauth: { configured: false, supported: false },
            transport: "stdio",
            disabled: false,
            command: form.command,
            args: splitArguments(form.args),
            cwd: form.cwd || undefined,
            env: pairs,
          }
        : {
            name: form.name,
            oauth: { configured: false, supported: true },
            transport: form.transport,
            disabled: false,
            url: form.url,
            headers: pairs,
          }
    try {
      await onSave(server)
    } catch (reason) {
      setError(errorMessage(reason))
      setSaving(false)
    }
  }

  return (
    <form className="mt-5 rounded-xl border bg-muted/20 p-4" onSubmit={submit}>
      <div className="mb-4">
        <h4 className="text-sm font-semibold">Add an MCP server</h4>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose how Blame should connect.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input
            ref={firstInput}
            required
            maxLength={80}
            placeholder="GitHub"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </Field>
        <Field label="Connection">
          <Select
            value={form.transport}
            onValueChange={(value) =>
              setForm({ ...form, transport: value as McpTransport })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stdio">Local command</SelectItem>
              <SelectItem value="streamableHttp">HTTP server</SelectItem>
              <SelectItem value="sse">SSE server (legacy)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {form.transport === "stdio" ? (
          <Field label="Command" className="sm:col-span-2">
            <Input
              required
              placeholder="npx"
              value={form.command}
              onChange={(event) =>
                setForm({ ...form, command: event.target.value })
              }
            />
          </Field>
        ) : (
          <Field label="Server URL" className="sm:col-span-2">
            <Input
              required
              type="url"
              placeholder="https://mcp.example.com"
              value={form.url}
              onChange={(event) =>
                setForm({ ...form, url: event.target.value })
              }
            />
          </Field>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-3 -ml-2"
        aria-expanded={advanced}
        onClick={() => setAdvanced(!advanced)}
      >
        Advanced options
        <ChevronDownIcon className={advanced ? "rotate-180" : ""} />
      </Button>
      {advanced && (
        <div className="mt-2 grid gap-4 border-t pt-4">
          {form.transport === "stdio" && (
            <>
              <Field
                label="Arguments"
                hint="Separate arguments with spaces. Use quotes around values containing spaces."
              >
                <Input
                  placeholder="-y @modelcontextprotocol/server-github"
                  value={form.args}
                  onChange={(event) =>
                    setForm({ ...form, args: event.target.value })
                  }
                />
              </Field>
              <Field label="Working directory">
                <Input
                  placeholder="/path/to/project"
                  value={form.cwd}
                  onChange={(event) =>
                    setForm({ ...form, cwd: event.target.value })
                  }
                />
              </Field>
            </>
          )}
          <KeyValueFields
            label={
              form.transport === "stdio"
                ? "Environment variables"
                : "Request headers"
            }
            entries={form.entries}
            onChange={(entries) => setForm({ ...form, entries })}
          />
        </div>
      )}
      {error && <Notice error>{error}</Notice>}
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Adding…" : "Add server"}
        </Button>
      </div>
    </form>
  )
}

function KeyValueFields({
  entries,
  label,
  onChange,
}: {
  entries: Entry[]
  label: string
  onChange(entries: Entry[]): void
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-2 grid gap-2">
        {entries.map((entry, index) => (
          <div className="flex gap-2" key={entry.id}>
            <Input
              aria-label={`${label} key ${index + 1}`}
              placeholder="Key"
              value={entry.key}
              onChange={(event) =>
                onChange(
                  entries.map((item) =>
                    item.id === entry.id
                      ? { ...item, key: event.target.value }
                      : item
                  )
                )
              }
            />
            <Input
              aria-label={`${label} value ${index + 1}`}
              placeholder="Value"
              type={label === "Environment variables" ? "password" : "text"}
              value={entry.value}
              onChange={(event) =>
                onChange(
                  entries.map((item) =>
                    item.id === entry.id
                      ? { ...item, value: event.target.value }
                      : item
                  )
                )
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Remove entry"
              onClick={() =>
                onChange(entries.filter((item) => item.id !== entry.id))
              }
            >
              <Trash2Icon />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() =>
            onChange([
              ...entries,
              { id: crypto.randomUUID(), key: "", value: "" },
            ])
          }
        >
          <PlusIcon />
          Add {entries.length ? "another" : "entry"}
        </Button>
      </div>
    </div>
  )
}

function Field({
  children,
  className,
  hint,
  label,
}: {
  children: React.ReactNode
  className?: string
  hint?: string
  label: string
}) {
  return (
    <div className={className}>
      <Label className="mb-2">{label}</Label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
function Notice({
  children,
  error,
}: {
  children: React.ReactNode
  error?: boolean
}) {
  return (
    <div
      className={`mt-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${error ? "border-destructive/30 text-destructive" : "text-muted-foreground"}`}
    >
      {error && <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />}
      {children}
    </div>
  )
}
function transportLabel(value: McpTransport) {
  return value === "stdio"
    ? "Local command"
    : value === "sse"
      ? "SSE · legacy"
      : "Streamable HTTP"
}
function errorMessage(reason: unknown) {
  return reason instanceof Error
    ? reason.message
    : "Could not update MCP servers."
}
function splitArguments(value: string) {
  return (
    value
      .match(/(?:[^\s"]+|"[^"]*")+/g)
      ?.map((part) => part.replace(/^"|"$/g, "")) ?? []
  )
}
