import * as React from "react"
import { LoaderCircleIcon, PlusIcon, SparklesIcon } from "lucide-react"
import { toast } from "sonner"

import {
  ConnectProviderDialog,
  ProviderSelectDialog,
} from "@/components/model/connect-provider-dialog"
import {
  ModelTags,
  ProviderMark,
  modelDisplayName,
  modelReactKey,
  type ModelPreferenceRole,
  type ModelSelection,
  type SelectableModel,
  useModelSelection,
} from "@/components/model/model-selector"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useCloudAuth } from "@/context/cloud-auth"

type SetupDialog =
  | { type: "providers" }
  | { type: "connect"; providerID: string }
  | undefined

type RoleSelection = {
  model?: SelectableModel
  variant?: string
}

const defaultVariant = "default"

export function AiPreferencesSetupScreen() {
  const auth = useCloudAuth()
  const alternativeSelection = useModelSelection({ role: "alternative" })
  const agentSelection = useModelSelection({ role: "agent" })
  const [alternative, setAlternative] = React.useState<RoleSelection>({})
  const [agent, setAgent] = React.useState<RoleSelection>({})
  const [dialog, setDialog] = React.useState<SetupDialog>()
  const [saving, setSaving] = React.useState(false)
  const providerSelection = agentSelection
  const alternativeValue = selectedRoleValue(
    alternative,
    alternativeSelection.currentModel
  )
  const agentValue = selectedRoleValue(agent, agentSelection.currentModel)
  const modelsAvailable = agentSelection.allProviderGroups.some(
    (group) => group.models.length > 0
  )
  const connected = providerSelection.connectedProviderIDs.size > 0
  const ready = connected && alternativeValue.model && agentValue.model

  async function save() {
    if (auth.status !== "authenticated" || !ready) return
    setSaving(true)
    try {
      await auth.saveAiPreferences({
        alternativeModel: preferencePayload(alternativeValue),
        agentModel: preferencePayload(agentValue),
      })
      toast.success("AI preferences saved", { position: "bottom-right" })
    } catch (error) {
      toast.error("Unable to save AI preferences", {
        description:
          error instanceof Error ? error.message : "Please try again.",
        position: "bottom-right",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="light flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <section className="grid w-full max-w-5xl gap-6">
        <div className="grid gap-2">
          <div className="flex size-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <SparklesIcon />
          </div>
          <h1 className="font-heading text-3xl font-semibold">
            Configure AI models
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Connect an AI provider, then choose the models Blame will use across
            every project.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <ProviderSetupPanel
            connected={connected}
            loading={providerSelection.loading}
            selection={providerSelection}
            onConnect={() => setDialog({ type: "providers" })}
            onRefresh={() => void providerSelection.refreshProviders()}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <PreferencePicker
              description="Recommended: choose a lighter, faster model for project initialization and approve and merge."
              role="alternative"
              selection={alternativeSelection}
              title="Alternative tasks"
              value={alternativeValue}
              onChange={setAlternative}
            />
            <PreferencePicker
              description="Recommended: choose a strong model for agentic coding tasks."
              role="agent"
              selection={agentSelection}
              title="Agentic coding"
              value={agentValue}
              onChange={setAgent}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            disabled={!ready || saving || !modelsAvailable}
            onClick={save}
          >
            {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
            Save preferences
          </Button>
        </div>
      </section>
      <ProviderSelectDialog
        open={dialog?.type === "providers"}
        selection={providerSelection}
        onConnect={(providerID) => setDialog({ type: "connect", providerID })}
        onOpenChange={(open) =>
          setDialog(open ? { type: "providers" } : undefined)
        }
      />
      <ConnectProviderDialog
        providerID={dialog?.type === "connect" ? dialog.providerID : undefined}
        selection={providerSelection}
        onBack={() => setDialog({ type: "providers" })}
        onOpenChange={(open) => {
          if (!open) setDialog(undefined)
        }}
      />
    </main>
  )
}

function ProviderSetupPanel({
  connected,
  loading,
  onConnect,
  onRefresh,
  selection,
}: {
  connected: boolean
  loading: boolean
  onConnect: () => void
  onRefresh: () => void
  selection: ModelSelection
}) {
  return (
    <div className="grid content-start gap-4 rounded-lg border bg-card p-4">
      <div className="grid gap-1">
        <h2 className="text-sm font-semibold">Provider</h2>
        <p className="text-sm text-muted-foreground">
          {connected
            ? "At least one provider is connected."
            : "Connect a provider before choosing models."}
        </p>
      </div>
      <div className="grid gap-2">
        {selection.credentials.slice(0, 4).map((credential) => {
          const provider = selection.allProviders.find(
            (item) => item.id === credential.providerId
          )
          if (!provider) return null
          return (
            <div
              key={credential.id}
              className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <ProviderMark provider={provider} />
              <span className="min-w-0 flex-1 truncate">{provider.name}</span>
            </div>
          )
        })}
      </div>
      <div className="flex gap-2">
        <Button onClick={onConnect}>
          <PlusIcon />
          Connect
        </Button>
        <Button variant="outline" onClick={onRefresh} disabled={loading}>
          {loading ? <LoaderCircleIcon className="animate-spin" /> : null}
          Refresh
        </Button>
      </div>
    </div>
  )
}

function PreferencePicker({
  description,
  onChange,
  role,
  selection,
  title,
  value,
}: {
  description: string
  onChange: (value: RoleSelection) => void
  role: ModelPreferenceRole
  selection: ModelSelection
  title: string
  value: RoleSelection
}) {
  return (
    <div className="grid min-h-96 gap-3 rounded-lg border bg-card p-4">
      <div className="grid gap-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Command className="min-h-0 rounded-md border">
        <CommandInput placeholder="Search models" />
        <CommandList className="max-h-64 overscroll-contain">
          <CommandEmpty>{selection.emptyMessage}</CommandEmpty>
          {selection.providerGroups.map((group) => (
            <CommandGroup
              key={`${role}-${group.provider.id}`}
              heading={group.provider.name}
            >
              {group.models.map((model) => (
                <CommandItem
                  key={`${role}-${modelReactKey(model)}`}
                  value={`${model.provider.name} ${model.name} ${model.id}`}
                  onSelect={() => onChange({ model })}
                >
                  <ProviderMark provider={model.provider} />
                  <span className="min-w-0 flex-1 truncate">
                    {modelDisplayName(model)}
                  </span>
                  <ModelTags model={model} />
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
      <div className="grid gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Selected
        </span>
        <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
          {value.model ? (
            <ProviderMark provider={value.model.provider} />
          ) : null}
          <span className="min-w-0 flex-1 truncate">
            {value.model ? modelDisplayName(value.model) : "No model selected"}
          </span>
        </div>
        <VariantSelect
          selection={selection}
          value={value}
          onChange={onChange}
        />
      </div>
    </div>
  )
}

function VariantSelect({
  onChange,
  selection,
  value,
}: {
  onChange: (value: RoleSelection) => void
  selection: ModelSelection
  value: RoleSelection
}) {
  const variants = [
    defaultVariant,
    ...Object.keys(
      value.model?.variants ?? selection.currentModel?.variants ?? {}
    ),
  ]
  if (variants.length <= 1) return null

  return (
    <Select
      value={value.variant ?? defaultVariant}
      onValueChange={(variant) =>
        onChange({
          ...value,
          variant: variant === defaultVariant ? undefined : variant,
        })
      }
    >
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {variants.map((variant) => (
          <SelectItem key={variant} value={variant} className="capitalize">
            {variantLabel(variant)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function preferencePayload(value: RoleSelection) {
  return {
    providerId: value.model!.provider.id,
    modelId: value.model!.id,
    credentialLabel: value.model!.credentialLabel ?? null,
    reasoningEffort: reasoningEffort(value.variant),
  }
}

function selectedRoleValue(
  value: RoleSelection,
  fallback: SelectableModel | undefined
) {
  return value.model || !fallback ? value : { ...value, model: fallback }
}

function reasoningEffort(value: string | undefined) {
  if (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  ) {
    return value
  }
  return null
}

function variantLabel(variant: string) {
  if (variant === defaultVariant) return "Default"
  if (variant === "xhigh") return "X High"
  return variant
}
