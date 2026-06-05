import { ArrowLeftIcon, LoaderCircleIcon, Trash2Icon } from "lucide-react"
import * as React from "react"
import type {
  BlameProvider as Provider,
  ProviderCredentialSummary,
} from "@blame/agent-runtime"

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
            Choose a provider and connect it to Blame.
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
                    {provider.id === "anthropic" ? (
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
  const credential = selection.credentials.find((item) => item.providerId === providerID)

  if (!provider) return null

  return (
    <Dialog open={!!providerID} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <ConnectProviderContent
          provider={provider}
          credential={credential}
          selection={selection}
          onBack={onBack}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function ConnectProviderContent({
  credential,
  onBack,
  onDone,
  provider,
  selection,
}: {
  credential?: ProviderCredentialSummary
  onBack: () => void
  onDone: () => void
  provider: Provider
  selection: ModelSelection
}) {
  const [apiKey, setApiKey] = React.useState("")
  const [baseUrl, setBaseUrl] = React.useState(credential?.baseUrl ?? "")
  const [modelId, setModelId] = React.useState(openAICompatibleModelId(credential))
  const [error, setError] = React.useState<string>()
  const [deleting, setDeleting] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [oauthLoading, setOauthLoading] = React.useState(false)
  const oauth = provider.capabilities?.includes("oauth")
  const openAICompatible = provider.id === "openaiCompatible"
  const showBaseUrl = openAICompatible

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
            <DialogTitle>{credential ? "Edit" : "Connect"} {provider.name}</DialogTitle>
            <DialogDescription>
              {credential ? "Update or remove this provider connection." : "Add an API key for this provider."}
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (oauth) {
            return
          }
          if (!apiKey.trim()) {
            setError("API key is required")
            return
          }
          if (openAICompatible && !modelId.trim()) {
            setError("Model ID is required")
            return
          }
          setError(undefined)
          setSaving(true)
          void selection.agent?.providers
            .saveCredential(selection.apiConnection, {
              providerId: provider.id,
              label: openAICompatible ? modelId.trim() : credential?.label,
              apiKey,
              baseUrl: showBaseUrl ? baseUrl.trim() || null : null,
            })
            .then(() => selection.refreshProviders())
            .then(onDone)
            .catch((error) =>
              setError(error instanceof Error ? error.message : "Unable to save API key")
            )
            .finally(() => setSaving(false))
        }}
      >
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {oauth ? (
          <Button
            type="button"
            disabled={oauthLoading || !selection.agent}
            onClick={() => {
              setError(undefined)
              setOauthLoading(true)
              void selection.agent?.providers
                .loginOAuth({
                  apiConnection: selection.apiConnection,
                  providerId: provider.id,
                  label: credential?.label,
                  baseUrl: showBaseUrl ? baseUrl.trim() || null : null,
                })
                .then(() => selection.refreshProviders())
                .then(onDone)
                .catch((error) =>
                  setError(error instanceof Error ? error.message : "Unable to connect OAuth provider")
                )
                .finally(() => setOauthLoading(false))
            }}
          >
            {oauthLoading ? <LoaderCircleIcon className="animate-spin" /> : null}
            Continue with OAuth
          </Button>
        ) : (
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
        )}
        {showBaseUrl ? (
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="provider-base-url">
              Base URL
            </label>
            <Input
              id="provider-base-url"
              value={baseUrl}
              placeholder="https://provider.example/v1"
              onChange={(event) => setBaseUrl(event.currentTarget.value)}
            />
          </div>
        ) : null}
        {openAICompatible ? (
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="provider-model-id">
              Model ID
            </label>
            <Input
              id="provider-model-id"
              value={modelId}
              placeholder="your-model-name"
              onChange={(event) => setModelId(event.currentTarget.value)}
            />
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          {credential ? (
            <Button
              type="button"
              variant="destructive"
              disabled={deleting || saving || !selection.agent}
              onClick={() => {
                setDeleting(true)
                setError(undefined)
                void selection.agent?.providers
                  .deleteCredential(selection.apiConnection, credential.id)
                  .then(() => selection.refreshProviders())
                  .then(onDone)
                  .catch((error) =>
                    setError(error instanceof Error ? error.message : "Unable to delete API key")
                  )
                  .finally(() => setDeleting(false))
              }}
            >
              {deleting ? <LoaderCircleIcon className="animate-spin" /> : <Trash2Icon />}
              Delete
            </Button>
          ) : <span />}
          <Button type="submit" disabled={oauth || saving || !selection.agent || !apiKey.trim() || (openAICompatible && !modelId.trim())}>
            {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
            {credential ? "Save" : "Continue"}
          </Button>
        </div>
      </form>
    </>
  )
}

function openAICompatibleModelId(credential: ProviderCredentialSummary | undefined) {
  if (credential?.providerId !== "openaiCompatible") return ""
  return credential.label === "default" ? "" : credential.label
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
      providers: items.sort((a, b) => getProviderRank(a.id) - getProviderRank(b.id) || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => (a.name === "Popular" ? -1 : b.name === "Popular" ? 1 : a.name.localeCompare(b.name)))
}

function getProviderRank(providerID: string) {
  const index = popularProviders.indexOf(providerID)
  return index === -1 ? popularProviders.length : index
}
