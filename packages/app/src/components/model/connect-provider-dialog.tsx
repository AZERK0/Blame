import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
} from "lucide-react"
import * as React from "react"
import type {
  Provider,
  ProviderAuthAuthorization,
  ProviderAuthMethod,
} from "@opencode-ai/sdk/v2/client"

import {
  ProviderMark,
  type ModelSelection,
  popularProviders,
} from "@/components/model/model-selector"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const apiAuthFallback: ProviderAuthMethod[] = [
  {
    type: "api",
    label: "API key",
  },
]

export function ProviderSelectDialog({
  onConnect,
  onOpenChange,
  open,
  selection,
}: {
  onConnect: (providerID: string) => void
  onOpenChange: (open: boolean) => void
  open: boolean
  selection: ModelSelection
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>Connect provider</DialogTitle>
          <DialogDescription>
            Choose a provider and connect it through the OpenCode sidecar.
          </DialogDescription>
        </DialogHeader>
        <Command className="min-h-0">
          <CommandInput placeholder="Search providers" />
          <CommandList className="max-h-[24rem] overscroll-contain">
            <CommandEmpty>No providers found</CommandEmpty>
            {groupProviders(selection.allProviders).map((group) => (
              <CommandGroup key={group.name} heading={group.name}>
                {group.providers.map((provider) => (
                  <CommandItem
                    key={provider.id}
                    value={`${provider.name} ${provider.id}`}
                    onSelect={() => onConnect(provider.id)}
                  >
                    <ProviderMark provider={provider} />
                    <span className="min-w-0 flex-1 truncate">{provider.name}</span>
                    {selection.connectedProviderIDs.has(provider.id) ? (
                      <Badge variant="secondary">Connected</Badge>
                    ) : null}
                    {provider.id === "opencode" || provider.id === "opencode-go" ? (
                      <Badge variant="outline">Recommended</Badge>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

export function ConnectProviderDialog({
  onBack,
  onOpenChange,
  providerID,
  selection,
}: {
  onBack: () => void
  onOpenChange: (open: boolean) => void
  providerID: string | undefined
  selection: ModelSelection
}) {
  const provider = selection.allProviders.find((item) => item.id === providerID)

  return (
    <Dialog open={!!providerID} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {provider ? (
          <ConnectProviderContent
            provider={provider}
            selection={selection}
            onBack={onBack}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ConnectProviderContent({
  onBack,
  onDone,
  provider,
  selection,
}: {
  onBack: () => void
  onDone: () => void
  provider: Provider
  selection: ModelSelection
}) {
  const [methods, setMethods] = React.useState<ProviderAuthMethod[]>()
  const [methodIndex, setMethodIndex] = React.useState<number>()
  const [authorization, setAuthorization] =
    React.useState<ProviderAuthAuthorization>()
  const [inputs, setInputs] = React.useState<Record<string, string>>({})
  const [apiKey, setApiKey] = React.useState("")
  const [code, setCode] = React.useState("")
  const [error, setError] = React.useState<string>()
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    let alive = true
    setLoading(true)
    setError(undefined)
    void selection.sdk?.provider
      .auth({ directory: selection.directory })
      .then((response) => {
        if (alive) setMethods(response.data?.[provider.id] ?? apiAuthFallback)
      })
      .catch((error) => {
        if (alive) {
          setMethods(apiAuthFallback)
          setError(formatError(error, "Unable to load auth methods"))
        }
      })
      .finally(() => {
        if (alive) setLoading(false)
      })

    return () => {
      alive = false
    }
  }, [provider.id, selection.directory, selection.sdk])

  React.useEffect(() => {
    if (!methods || methods.length !== 1 || methodIndex !== undefined) return
    setMethodIndex(0)
  }, [methodIndex, methods])

  const method = methodIndex === undefined ? undefined : methods?.[methodIndex]

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-3 pr-8">
          <Button size="icon-sm" variant="ghost" onClick={onBack}>
            <ArrowLeftIcon />
            <span className="sr-only">Back</span>
          </Button>
          <ProviderMark provider={provider} />
          <div className="grid gap-1">
            <DialogTitle>Connect {provider.name}</DialogTitle>
            <DialogDescription>
              Add credentials to make this provider available.
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircleIcon className="size-4 animate-spin" />
          Loading auth methods
        </div>
      ) : null}
      {!loading && methodIndex === undefined ? (
        <AuthMethodList methods={methods ?? []} onSelect={setMethodIndex} />
      ) : null}
      {method?.type === "api" ? (
        <ApiAuthForm
          apiKey={apiKey}
          provider={provider}
          saving={loading}
          setApiKey={setApiKey}
          setError={setError}
          setLoading={setLoading}
          selection={selection}
          onDone={onDone}
        />
      ) : null}
      {method?.type === "oauth" && !authorization ? (
        <OAuthAuthorizeForm
          inputs={inputs}
          methodIndex={methodIndex}
          method={method}
          provider={provider}
          selection={selection}
          setAuthorization={setAuthorization}
          setError={setError}
          setInputs={setInputs}
          setLoading={setLoading}
        />
      ) : null}
      {method?.type === "oauth" && authorization ? (
        <OAuthCallbackForm
          authorization={authorization}
          code={code}
          methodIndex={methodIndex}
          provider={provider}
          selection={selection}
          setCode={setCode}
          setError={setError}
          setLoading={setLoading}
          onDone={onDone}
        />
      ) : null}
    </>
  )
}

function AuthMethodList({
  methods,
  onSelect,
}: {
  methods: ProviderAuthMethod[]
  onSelect: (index: number) => void
}) {
  return (
    <div className="grid gap-2">
      <p className="text-sm text-muted-foreground">Select an auth method.</p>
      <div className="grid gap-1">
        {methods.map((method, index) => (
          <Button
            key={`${method.type}:${method.label}:${index}`}
            variant="outline"
            className="justify-start"
            onClick={() => onSelect(index)}
          >
            {getMethodLabel(method)}
          </Button>
        ))}
      </div>
    </div>
  )
}

function ApiAuthForm({
  apiKey,
  onDone,
  provider,
  saving,
  selection,
  setApiKey,
  setError,
  setLoading,
}: {
  apiKey: string
  onDone: () => void
  provider: Provider
  saving: boolean
  selection: ModelSelection
  setApiKey: (value: string) => void
  setError: (value: string | undefined) => void
  setLoading: (value: boolean) => void
}) {
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!apiKey.trim()) {
          setError("API key is required")
          return
        }
        setError(undefined)
        setLoading(true)
        void selection.sdk?.auth
          .set({
            providerID: provider.id,
            auth: { type: "api", key: apiKey },
          })
          .then(() => selection.refreshProviders())
          .then(onDone)
          .catch((error) =>
            setError(formatError(error, "Unable to save API key"))
          )
          .finally(() => setLoading(false))
      }}
    >
      <div className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="provider-api-key">
          {provider.name} API key
        </label>
        <Input
          id="provider-api-key"
          value={apiKey}
          placeholder="Enter API key"
          onChange={(event) => setApiKey(event.currentTarget.value)}
        />
      </div>
      <Button type="submit" disabled={saving}>
        {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
        Continue
      </Button>
    </form>
  )
}

function OAuthAuthorizeForm({
  inputs,
  method,
  methodIndex,
  provider,
  selection,
  setAuthorization,
  setError,
  setInputs,
  setLoading,
}: {
  inputs: Record<string, string>
  method: ProviderAuthMethod
  methodIndex: number | undefined
  provider: Provider
  selection: ModelSelection
  setAuthorization: (authorization: ProviderAuthAuthorization) => void
  setError: (value: string | undefined) => void
  setInputs: (value: Record<string, string>) => void
  setLoading: (value: boolean) => void
}) {
  const prompts = method.prompts ?? []

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        setError(undefined)
        setLoading(true)
        void selection.sdk?.provider.oauth
          .authorize(
            {
              providerID: provider.id,
              directory: selection.directory,
              method: methodIndex,
              inputs,
            },
            { throwOnError: true }
          )
          .then((response) => setAuthorization(response.data!))
          .catch((error) =>
            setError(formatError(error, "Unable to start OAuth authorization"))
          )
          .finally(() => setLoading(false))
      }}
    >
      {prompts.map((prompt) =>
        prompt.type === "select" ? (
          <PromptSelect
            key={prompt.key}
            prompt={prompt}
            inputs={inputs}
            setInputs={setInputs}
          />
        ) : (
          <PromptInput
            key={prompt.key}
            prompt={prompt}
            inputs={inputs}
            setInputs={setInputs}
          />
        )
      )}
      <Button type="submit">Continue</Button>
    </form>
  )
}

function OAuthCallbackForm({
  authorization,
  code,
  methodIndex,
  onDone,
  provider,
  selection,
  setCode,
  setError,
  setLoading,
}: {
  authorization: ProviderAuthAuthorization
  code: string
  methodIndex: number | undefined
  onDone: () => void
  provider: Provider
  selection: ModelSelection
  setCode: (value: string) => void
  setError: (value: string | undefined) => void
  setLoading: (value: boolean) => void
}) {
  const sdk = selection.sdk
  const directory = selection.directory
  const refreshProviders = selection.refreshProviders

  React.useEffect(() => {
    if (authorization.method !== "auto") return
    let alive = true
    setLoading(true)
    void sdk?.provider.oauth
      .callback({
        providerID: provider.id,
        directory,
        method: methodIndex,
      })
      .then(() => refreshProviders())
      .then(() => {
        if (alive) onDone()
      })
      .catch((error) => {
        if (alive) setError(formatError(error, "OAuth callback failed"))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })

    return () => {
      alive = false
    }
  }, [
    authorization.method,
    directory,
    methodIndex,
    onDone,
    provider.id,
    refreshProviders,
    sdk,
    setError,
    setLoading,
  ])

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        setError(undefined)
        setLoading(true)
        void selection.sdk?.provider.oauth
          .callback({
            providerID: provider.id,
            directory: selection.directory,
            method: methodIndex,
            code: authorization.method === "code" ? code : undefined,
          })
          .then(() => selection.refreshProviders())
          .then(onDone)
          .catch((error) =>
            setError(formatError(error, "OAuth callback failed"))
          )
          .finally(() => setLoading(false))
      }}
    >
      <Button asChild variant="outline">
        <a href={authorization.url} target="_blank" rel="noreferrer">
          Open authorization page
          <ExternalLinkIcon />
        </a>
      </Button>
      {authorization.instructions ? (
        <p className="text-sm text-muted-foreground">{authorization.instructions}</p>
      ) : null}
      {authorization.method === "code" ? (
        <div className="grid gap-2">
          <label className="text-sm font-medium" htmlFor="oauth-code">
            Authorization code
          </label>
          <Input
            id="oauth-code"
            value={code}
            placeholder="Paste code"
            onChange={(event) => setCode(event.currentTarget.value)}
          />
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircleIcon className="size-4 animate-spin" />
          Waiting for authorization
        </div>
      )}
      {authorization.method === "code" ? (
        <Button type="submit">Continue</Button>
      ) : null}
    </form>
  )
}

function PromptInput({
  inputs,
  prompt,
  setInputs,
}: {
  inputs: Record<string, string>
  prompt: Extract<
    NonNullable<ProviderAuthMethod["prompts"]>[number],
    { type: "text" }
  >
  setInputs: (value: Record<string, string>) => void
}) {
  if (!promptVisible(prompt, inputs)) return null

  return (
    <div className="grid gap-2">
      <label className="text-sm font-medium" htmlFor={prompt.key}>
        {prompt.message}
      </label>
      <Input
        id={prompt.key}
        value={inputs[prompt.key] ?? ""}
        placeholder={prompt.placeholder}
        onChange={(event) =>
          setInputs({ ...inputs, [prompt.key]: event.currentTarget.value })
        }
      />
    </div>
  )
}

function PromptSelect({
  inputs,
  prompt,
  setInputs,
}: {
  inputs: Record<string, string>
  prompt: Extract<
    NonNullable<ProviderAuthMethod["prompts"]>[number],
    { type: "select" }
  >
  setInputs: (value: Record<string, string>) => void
}) {
  if (!promptVisible(prompt, inputs)) return null

  return (
    <div className="grid gap-2">
      <label className="text-sm font-medium">{prompt.message}</label>
      <Select
        value={inputs[prompt.key] ?? ""}
        onValueChange={(value) => setInputs({ ...inputs, [prompt.key]: value })}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select option" />
        </SelectTrigger>
        <SelectContent>
          {prompt.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function groupProviders(providers: Provider[]) {
  const groups = providers.reduce((map, provider) => {
    const name = popularProviders.includes(provider.id) ? "Popular" : "Other"
    map.set(name, [...(map.get(name) ?? []), provider])
    return map
  }, new Map<string, Provider[]>())

  return Array.from(groups.entries())
    .map(([name, items]) => ({
      name,
      providers: items.sort(
        (a, b) =>
          getProviderRank(a.id) - getProviderRank(b.id) ||
          a.name.localeCompare(b.name)
      ),
    }))
    .sort(
      (a, b) =>
        (a.name === "Popular" ? -1 : 1) -
        (b.name === "Popular" ? -1 : 1)
    )
}

function getProviderRank(providerID: string) {
  const index = popularProviders.indexOf(providerID)
  return index === -1 ? popularProviders.length : index
}

function getMethodLabel(method: ProviderAuthMethod) {
  if (method.type === "api") return "API key"
  return method.label
}

function promptVisible(
  prompt: NonNullable<ProviderAuthMethod["prompts"]>[number],
  inputs: Record<string, string>
) {
  if (!prompt.when) return true
  const value = inputs[prompt.when.key]
  if (value === undefined) return false
  return prompt.when.op === "eq"
    ? value === prompt.when.value
    : value !== prompt.when.value
}

function formatError(value: unknown, fallback: string) {
  if (value instanceof Error && value.message) return value.message
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message
    if (typeof message === "string" && message) return message
  }
  if (value && typeof value === "object" && "data" in value) {
    const data = (value as { data?: { message?: unknown } }).data
    if (typeof data?.message === "string" && data.message) return data.message
  }
  return fallback
}
