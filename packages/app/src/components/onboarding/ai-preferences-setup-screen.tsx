import * as React from "react"
import type { ReasoningSelection } from "@blame/agent-runtime"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
} from "lucide-react"
import { toast } from "sonner"

import { CompactWindowChrome } from "@/components/layout/compact-window-chrome"
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
import { cn } from "@/lib/utils"

type SetupDialog =
  | { type: "providers" }
  | { type: "connect"; providerID: string }
  | undefined

type RoleSelection = {
  model?: SelectableModel
  variant?: string
}

const defaultVariant = "default"
const setupSteps = ["Providers", "Agentic coding", "Other tasks"] as const

export function AiPreferencesSetupScreen() {
  const auth = useCloudAuth()
  const agentSelection = useModelSelection({ role: "agent" })
  const [alternative, setAlternative] = React.useState<RoleSelection>({})
  const [agent, setAgent] = React.useState<RoleSelection>({})
  const [dialog, setDialog] = React.useState<SetupDialog>()
  const [saving, setSaving] = React.useState(false)
  const [step, setStep] = React.useState(0)
  const providerSelection = agentSelection
  const connected = providerSelection.connectedProviderIDs.size > 0
  const ready = connected && alternative.model && agent.model

  function canOpenStep(index: number) {
    if (index === 0) return true
    if (index === 1) return connected
    return connected && !!agent.model
  }

  async function save() {
    if (auth.status !== "authenticated" || !ready) return
    setSaving(true)
    try {
      await auth.saveAiPreferences({
        alternativeModel: preferencePayload(alternative),
        agentModel: preferencePayload(agent),
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
    <main className="light relative flex h-svh items-center justify-center overflow-y-auto bg-background px-4 pt-14 pb-16 text-foreground sm:px-8">
      <CompactWindowChrome />
      <section className="grid w-full max-w-3xl gap-6">
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            Configure your models
          </h1>
        </div>
        <nav aria-label="AI setup progress" className="grid grid-cols-3 gap-2">
          {setupSteps.map((label, index) => (
            <button
              key={label}
              type="button"
              disabled={!canOpenStep(index)}
              aria-current={step === index ? "step" : undefined}
              className="group grid gap-2 text-left outline-none disabled:cursor-not-allowed disabled:opacity-45"
              onClick={() => setStep(index)}
            >
              <span
                className={cn(
                  "h-1 rounded-full bg-muted transition-colors group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2",
                  step === index && "bg-primary",
                  step > index && "bg-primary/45"
                )}
              />
              <span className="flex min-w-0 items-center gap-2 px-0.5">
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold text-muted-foreground",
                    step === index &&
                      "border-primary bg-primary text-primary-foreground",
                    step > index && "border-primary/40 text-primary"
                  )}
                >
                  {step > index ? <CheckIcon className="size-3" /> : index + 1}
                </span>
                <span
                  className={cn(
                    "truncate text-xs font-medium text-muted-foreground sm:text-sm",
                    step === index && "text-foreground"
                  )}
                >
                  {label}
                </span>
              </span>
            </button>
          ))}
        </nav>
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="min-h-[28rem] p-5 sm:p-6">
            {step === 0 ? (
              <ProviderSetupPanel
                connected={connected}
                loading={providerSelection.loading}
                selection={providerSelection}
                onConnect={() => setDialog({ type: "providers" })}
                onRefresh={() => void providerSelection.refreshProviders()}
              />
            ) : null}
            {step === 1 ? (
              <PreferencePicker
                description="For planning, coding, and verification."
                role="agent"
                selection={agentSelection}
                title="Choose your agentic coding model"
                value={agent}
                onChange={setAgent}
              />
            ) : null}
            {step === 2 ? (
              <PreferencePicker
                description="For project setup and lighter tasks."
                role="alternative"
                selection={agentSelection}
                title="Choose your other tasks model"
                value={alternative}
                onChange={setAlternative}
              />
            ) : null}
          </div>
          <div className="flex items-center justify-between border-t bg-muted/25 px-5 py-4 sm:px-6">
            <Button
              type="button"
              variant="ghost"
              className={cn(step === 0 && "invisible")}
              tabIndex={step === 0 ? -1 : undefined}
              onClick={() => setStep((current) => Math.max(0, current - 1))}
            >
              <ArrowLeftIcon /> Back
            </Button>
            {step < 2 ? (
              <Button
                type="button"
                disabled={step === 0 ? !connected : !agent.model}
                onClick={() => setStep((current) => Math.min(2, current + 1))}
              >
                Continue <ArrowRightIcon />
              </Button>
            ) : (
              <Button disabled={!ready || saving} onClick={save}>
                {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
                Save preferences
              </Button>
            )}
          </div>
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
  const connectedProviders = selection.allProviders.filter((provider) =>
    selection.connectedProviderIDs.has(provider.id)
  )

  return (
    <div className="grid content-start gap-6">
      <div className="grid gap-1.5">
        <p className="text-xs font-medium text-primary">Step 1 of 3</p>
        <h2 className="font-heading text-xl font-semibold">
          Connect a provider
        </h2>
        <p className="text-sm text-muted-foreground">
          Use your own provider credentials with Blame.
        </p>
      </div>
      {connectedProviders.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {connectedProviders.map((provider) => (
            <div
              key={provider.id}
              className="flex min-w-0 items-center gap-3 rounded-lg border bg-background/60 px-3 py-3"
            >
              <ProviderMark provider={provider} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {provider.name}
              </span>
              <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-primary">
                <CheckIcon className="size-3" />
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex min-h-32 items-center justify-center rounded-lg border bg-background/40 px-4 text-center">
          <span className="text-sm font-medium">No provider connected</span>
        </div>
      )}
      <div className="flex gap-2">
        <Button onClick={onConnect}>
          <PlusIcon />
          {connected ? "Add provider" : "Connect provider"}
        </Button>
        <Button
          variant="outline"
          onClick={onRefresh}
          disabled={loading}
          aria-label="Refresh providers"
        >
          <RefreshCwIcon className={cn(loading && "animate-spin")} />
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
  const selectedModelKey = value.model ? modelReactKey(value.model) : undefined

  return (
    <div className="grid content-start gap-5">
      <div className="grid gap-1.5">
        <p className="text-xs font-medium text-primary">
          Step {role === "agent" ? "2" : "3"} of 3
        </p>
        <h2 className="font-heading text-xl font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Selected model
        </span>
        <div className="flex min-w-0 items-center gap-3 rounded-lg border bg-background/60 px-3 py-3">
          {value.model ? (
            <ProviderMark provider={value.model.provider} />
          ) : null}
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {value.model ? modelDisplayName(value.model) : "No model selected"}
          </span>
          <VariantSelect value={value} onChange={onChange} />
        </div>
      </div>
      <Command className="min-h-0 rounded-lg border bg-background/40">
        <CommandInput placeholder="Search models" />
        <CommandList className="h-60 max-h-60 overscroll-contain">
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
                  aria-selected={modelReactKey(model) === selectedModelKey}
                  className="aria-selected:bg-accent"
                >
                  <ProviderMark provider={model.provider} />
                  <span className="min-w-0 flex-1 truncate">
                    {modelDisplayName(model)}
                  </span>
                  <ModelTags model={model} />
                  {modelReactKey(model) === selectedModelKey ? (
                    <CheckIcon className="size-4 text-primary" />
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </div>
  )
}

function VariantSelect({
  onChange,
  value,
}: {
  onChange: (value: RoleSelection) => void
  value: RoleSelection
}) {
  const variants = [defaultVariant, ...Object.keys(value.model?.variants ?? {})]
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
      <SelectTrigger className="h-7 w-auto max-w-36 border-0 bg-muted/60 px-2 text-xs shadow-none">
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

function reasoningEffort(value: string | undefined): ReasoningSelection | null {
  if (
    value === "none" ||
    value === "enabled" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
  ) {
    return value
  }
  return null
}

function variantLabel(variant: string) {
  if (variant === defaultVariant) return "Default"
  if (variant === "xhigh") return "X High"
  return variant.charAt(0).toUpperCase() + variant.slice(1)
}
