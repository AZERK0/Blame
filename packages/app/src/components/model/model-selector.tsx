import {
  ChevronsUpDownIcon,
  PlusIcon,
  SlidersHorizontalIcon,
} from "lucide-react"
import * as React from "react"
import type {
  AgentContextCompressionMode,
  BlameModel as Model,
  BlameProvider as Provider,
  ProviderCredentialSummary,
  ProviderListResponse,
  ReasoningEffort,
} from "@blame/agent-runtime"

import {
  ConnectProviderDialog,
  ProviderSelectDialog,
} from "@/components/model/connect-provider-dialog"
import { ManageModelsDialog } from "@/components/model/manage-models-dialog"
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useCloudAuth } from "@/context/cloud-auth"
import { usePlatform } from "@/context/platform"
import { ButtonGroup } from "@/components/ui/button-group.tsx"
import type {
  CloudAiModelPreference,
  SaveAiPreferencesInput,
} from "@/context/cloud-auth"

const storageKey = "blame.app.drawer-model-selection.v1"
const contextCompressionStorageKey =
  "blame.app.context-compression-mode.v1"
const globalModelSelectionKey = "__global__"
const recentLimit = 5
const defaultVariant = "default"
const defaultContextCompressionMode = "cline"
const defaultCredentialLabel = "default"
const openAICompatibleProviderID = "openai-compatible"
const modelStateListeners = new Set<() => void>()
const contextCompressionListeners = new Set<() => void>()
const contextCompressionModeOptions: {
  label: string
  value: AgentContextCompressionMode
}[] = [
  { label: "Cline", value: "cline" },
  { label: "Headroom", value: "headroom" },
  { label: "Off", value: "off" },
]
export const popularProviders = [
  "openai-codex",
  "openai",
  "openai-native",
  "anthropic",
  "google",
  "github-copilot",
  "openrouter",
  "vercel",
]

export type ModelKey = {
  providerID: string
  modelID: string
  credentialLabel?: string
}

export type SelectableModel = Omit<Model, "providerID"> & {
  provider: Provider
  credentialLabel?: string
  credentialDisplayName?: string
  showCredentialLabel?: boolean
  latest: boolean
}

export type ModelGroup = {
  provider: Provider
  models: SelectableModel[]
  rank: number
}

type ModelSelectionState = {
  recent: ModelKey[]
  hidden: ModelKey[]
}

export type ModelSelection = ReturnType<typeof useModelSelection>
export type ModelPreferenceRole = "alternative" | "agent"
type ModelSelectionOptions = {
  role?: ModelPreferenceRole
}
type ModelDialog =
  | { type: "providers" }
  | { type: "connect"; providerID: string }
  | { type: "manage" }
  | undefined

export function ModelSelector({ role }: { role?: ModelPreferenceRole }) {
  const selection = useModelSelection({ role })
  const [dialog, setDialog] = React.useState<ModelDialog>()

  return (
    <>
      <ButtonGroup className="w-full min-w-0">
        <ModelPicker selection={selection} setDialog={setDialog} />
        <ModelVariantSelector selection={selection} />
        {selection.role === "agent" ? (
          <ContextCompressionSelector selection={selection} />
        ) : null}
      </ButtonGroup>
      <ProviderSelectDialog
        open={dialog?.type === "providers"}
        selection={selection}
        onConnect={(providerID) => setDialog({ type: "connect", providerID })}
        onOpenChange={(open) =>
          setDialog(open ? { type: "providers" } : undefined)
        }
      />
      <ConnectProviderDialog
        providerID={dialog?.type === "connect" ? dialog.providerID : undefined}
        selection={selection}
        onBack={() => setDialog({ type: "providers" })}
        onOpenChange={(open) => {
          if (!open) setDialog(undefined)
        }}
      />
      <ManageModelsDialog
        open={dialog?.type === "manage"}
        selection={selection}
        onConnectProvider={() => setDialog({ type: "providers" })}
        onOpenChange={(open) =>
          setDialog(open ? { type: "manage" } : undefined)
        }
      />
    </>
  )
}

function ModelPicker({
  selection,
  setDialog,
}: {
  selection: ModelSelection
  setDialog: (dialog: ModelDialog) => void
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="w-0 min-w-0 flex-1 justify-start"
              disabled={!selection.serverReady || selection.loading}
            >
              <ModelSummary model={selection.currentModel} />
              <ChevronsUpDownIcon className="shrink-0 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="left">Choose model</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="start"
        side="left"
        className="h-80 w-80 overflow-hidden p-0"
        onWheel={(event) => event.stopPropagation()}
      >
        <Command className="h-full min-h-0">
          <CommandInput placeholder="Search models" />
          <CommandList
            className="h-[14.75rem] max-h-[14.75rem] min-h-0 overscroll-contain"
            onWheel={(event) => event.stopPropagation()}
          >
            <CommandEmpty>{selection.emptyMessage}</CommandEmpty>
            {selection.providerGroups.map((group) => (
              <CommandGroup
                key={group.provider.id}
                heading={group.provider.name}
              >
                {group.models.map((model) => (
                  <ModelCommandItem
                    key={modelReactKey(model)}
                    model={model}
                    selected={isModelSelected(selection.currentModel, model)}
                    onSelect={() => {
                      void selection.setModel(model)
                      setOpen(false)
                    }}
                  />
                ))}
              </CommandGroup>
            ))}
          </CommandList>
          <div className="flex items-center justify-end gap-1 border-t p-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => {
                    setOpen(false)
                    setDialog({ type: "providers" })
                  }}
                >
                  <PlusIcon />
                  <span className="sr-only">Connect provider</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Connect provider</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => {
                    setOpen(false)
                    setDialog({ type: "manage" })
                  }}
                >
                  <SlidersHorizontalIcon />
                  <span className="sr-only">Manage models</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Manage models</TooltipContent>
            </Tooltip>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function ModelVariantSelector({ selection }: { selection: ModelSelection }) {
  if (selection.variantOptions.length <= 2) return null

  return (
    <Select
      value={selection.currentVariant ?? defaultVariant}
      onValueChange={(value) => {
        void selection.setVariant(value === defaultVariant ? undefined : value)
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <SelectTrigger className="w-28 max-w-[45%] capitalize">
            <SelectValue />
          </SelectTrigger>
        </TooltipTrigger>
        <TooltipContent side="left">Choose thinking mode</TooltipContent>
      </Tooltip>
      <SelectContent>
        {selection.variantOptions.map((variant) => (
          <SelectItem key={variant} value={variant} className="capitalize">
            {getVariantLabel(variant)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function ContextCompressionSelector({
  selection,
}: {
  selection: ModelSelection
}) {
  return (
    <Select
      value={selection.contextCompressionMode}
      onValueChange={(value) =>
        selection.setContextCompressionMode(contextCompressionMode(value))
      }
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <SelectTrigger className="w-28 max-w-[45%]">
            <SelectValue />
          </SelectTrigger>
        </TooltipTrigger>
        <TooltipContent side="left">Choose context mode</TooltipContent>
      </Tooltip>
      <SelectContent>
        {contextCompressionModeOptions.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function ModelCommandItem({
  model,
  onSelect,
  selected,
}: {
  model: SelectableModel
  onSelect: () => void
  selected: boolean
}) {
  return (
    <CommandItem
      value={`${model.provider.name} ${model.name} ${model.id} ${model.credentialDisplayName ?? ""}`}
      data-checked={selected}
      onSelect={onSelect}
    >
      <ProviderMark provider={model.provider} />
      <span className="min-w-0 flex-1 truncate">{modelDisplayName(model)}</span>
      <ModelTags model={model} />
    </CommandItem>
  )
}

function ModelSummary({ model }: { model: SelectableModel | undefined }) {
  if (!model) {
    return (
      <span className="min-w-0 truncate text-muted-foreground">
        Select model
      </span>
    )
  }

  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <ProviderMark provider={model.provider} />
      <span className="min-w-0 flex-1 truncate">
        {modelDisplayName(model)}
      </span>
    </span>
  )
}

export function modelDisplayName(model: SelectableModel) {
  if (!model.showCredentialLabel || !model.credentialDisplayName)
    return model.name
  return `${model.name} · ${model.credentialDisplayName}`
}

export function modelReactKey(model: SelectableModel) {
  return `${model.provider.id}:${model.id}:${model.credentialLabel ?? defaultCredentialLabel}`
}

export function ModelTags({ model }: { model: SelectableModel }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {modelFree(model) ? (
        <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
          Free
        </span>
      ) : null}
      {model.latest ? (
        <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
          Latest
        </span>
      ) : null}
    </span>
  )
}

function modelFree(model: SelectableModel) {
  if (model.provider.id === openAICompatibleProviderID) return false
  return model.cost.input === 0 && model.cost.output === 0
}

export function ProviderMark({ provider }: { provider: Provider }) {
  return (
    <span
      aria-label={provider.name}
      className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted/60 text-[10px] font-semibold uppercase"
    >
      {provider.name.slice(0, 2)}
    </span>
  )
}

export function useModelSelection(options: ModelSelectionOptions = {}) {
  const providerState = useProviderState()
  const role = options.role ?? "agent"
  const [state, setState] = React.useState(() =>
    readModelState(providerState.directory)
  )
  const [contextCompressionMode, setContextCompressionModeState] =
    React.useState(readContextCompressionMode)

  React.useEffect(() => {
    const refreshState = () => setState(readModelState(providerState.directory))
    const refreshContextMode = () =>
      setContextCompressionModeState(readContextCompressionMode())
    const handleStorageChange = (event: StorageEvent) => {
      if (event.storageArea === localStorage && event.key === storageKey) {
        refreshState()
      }
    }

    refreshState()
    modelStateListeners.add(refreshState)
    contextCompressionListeners.add(refreshContextMode)
    window.addEventListener("storage", handleStorageChange)

    return () => {
      modelStateListeners.delete(refreshState)
      contextCompressionListeners.delete(refreshContextMode)
      window.removeEventListener("storage", handleStorageChange)
    }
  }, [providerState.directory])

  React.useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (
        event.storageArea === localStorage &&
        event.key === contextCompressionStorageKey
      ) {
        setContextCompressionModeState(readContextCompressionMode())
      }
    }
    window.addEventListener("storage", handleStorageChange)
    return () => window.removeEventListener("storage", handleStorageChange)
  }, [])

  const models = React.useMemo(
    () => getModels(providerState.providers),
    [providerState.providers]
  )
  const visibleModels = React.useMemo(
    () => models.filter((model) => modelVisible(state, model)),
    [models, state]
  )
  const preference = modelPreference(providerState.aiPreferences, role)
  const currentModel =
    findModel(visibleModels, preferenceModelKey(preference)) ??
    getDefaultModel(visibleModels, providerState.providers)
  const currentVariant = getCurrentVariant(
    currentModel,
    preference?.reasoningEffort
  )

  return {
    agent: providerState.agent,
    aiPreferences: providerState.aiPreferences,
    apiConnection: providerState.apiConnection,
    loading: providerState.loading,
    allProviderGroups: groupModels(models),
    allProviders: providerState.providers?.all ?? [],
    credentials: providerState.providers?.credentials ?? [],
    connectedProviderIDs: getConnectedProviderIDs(providerState.providers),
    contextCompressionMode,
    currentModel,
    currentVariant,
    directory: providerState.directory,
    emptyMessage: getEmptyMessage(providerState),
    providerGroups: groupModels(visibleModels),
    refreshProviders: providerState.refresh,
    serverReady: providerState.serverReady,
    variantOptions: getVariantOptions(currentModel),
    role,
    saveAiPreferences: providerState.saveAiPreferences,
    setModel: async (model: SelectableModel) => {
      setModelState(providerState.directory, setState, {
        ...state,
        recent: pushRecent(state.recent, model),
        hidden: state.hidden.filter(
          (item) => !sameModelKey(item, modelKey(model))
        ),
      })
      await saveRolePreference(providerState, role, modelPreferenceInput(model))
    },
    modelVisible: (model: SelectableModel) => modelVisible(state, model),
    providerVisible: (providerID: string) =>
      models
        .filter((model) => model.provider.id === providerID)
        .every((model) => modelVisible(state, model)),
    setModelVisible: (model: SelectableModel, visible: boolean) =>
      setModelState(providerState.directory, setState, {
        ...state,
        hidden: setHiddenModel(state.hidden, model, visible),
      }),
    setProviderVisible: (providerID: string, visible: boolean) =>
      setModelState(providerState.directory, setState, {
        ...state,
        hidden: setHiddenProvider(state.hidden, models, providerID, visible),
      }),
    setVariant: (variant: string | undefined) =>
      saveRolePreference(providerState, role, {
        providerId: currentModel?.provider.id ?? "",
        modelId: currentModel?.id ?? "",
        credentialLabel: currentModel?.credentialLabel ?? null,
        reasoningEffort: isReasoningEffort(variant ?? "") ? variant : null,
      }),
    setContextCompressionMode: (mode: AgentContextCompressionMode) => {
      localStorage.setItem(contextCompressionStorageKey, mode)
      setContextCompressionModeState(mode)
      for (const listener of contextCompressionListeners) listener()
    },
  }
}

function useProviderState() {
  const auth = useCloudAuth()
  const platform = usePlatform()
  const directory = globalModelSelectionKey
  const [providers, setProviders] = React.useState<ProviderListResponse>()
  const [loading, setLoading] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const agent = platform.agent

  const refresh = React.useCallback(() => {
    if (!agent || auth.status !== "authenticated") {
      setProviders(undefined)
      return Promise.resolve()
    }

    setLoading(true)
    setFailed(false)
    return agent.providers
      .list(auth.apiConnection)
      .then((response) => {
        setProviders(normalizeProviderList(response))
      })
      .catch((error) => {
        console.error("[renderer] providers:list failed", error)
        setFailed(true)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [agent, auth.apiConnection, auth.status])

  React.useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refresh().then(() => undefined)
    })
    return () => window.clearTimeout(timeout)
  }, [refresh])

  return {
    apiConnection: auth.apiConnection,
    directory,
    failed,
    loading,
    providers,
    refresh,
    aiPreferences:
      auth.status === "authenticated" ? auth.aiPreferences : undefined,
    saveAiPreferences:
      auth.status === "authenticated" ? auth.saveAiPreferences : undefined,
    agent,
    serverReady: !!agent,
  }
}

function normalizeProviderList(input: ProviderListResponse | undefined) {
  if (!input) return undefined
  return {
    ...input,
    all: input.all.map((provider) => ({
      ...provider,
      models: Object.fromEntries(
        Object.entries(provider.models).filter(
          ([, model]) => model.status !== "deprecated"
        )
      ),
    })),
  }
}

function modelPreference(
  preferences:
    | {
        alternativeModel: CloudAiModelPreference
        agentModel: CloudAiModelPreference
      }
    | null
    | undefined,
  role: ModelPreferenceRole
) {
  if (!preferences) return undefined
  return role === "alternative"
    ? preferences.alternativeModel
    : preferences.agentModel
}

function preferenceModelKey(
  preference: CloudAiModelPreference | undefined
): ModelKey | undefined {
  if (!preference) return undefined
  return {
    providerID: preference.providerId,
    modelID: preference.modelId,
    credentialLabel: preference.credentialLabel ?? undefined,
  }
}

function modelPreferenceInput(model: SelectableModel): CloudAiModelPreference {
  return {
    providerId: model.provider.id,
    modelId: model.id,
    credentialLabel: model.credentialLabel ?? null,
    reasoningEffort: null,
  }
}

async function saveRolePreference(
  providerState: {
    aiPreferences?: SaveAiPreferencesInput | null
    saveAiPreferences?: (input: SaveAiPreferencesInput) => Promise<void>
  },
  role: ModelPreferenceRole,
  preference: CloudAiModelPreference
) {
  if (!providerState.saveAiPreferences || !preference.providerId) return
  const current = providerState.aiPreferences
  if (!current) return
  await providerState.saveAiPreferences({
    alternativeModel:
      role === "alternative" ? preference : current.alternativeModel,
    agentModel: role === "agent" ? preference : current.agentModel,
  })
}

function getModels(providers: ProviderListResponse | undefined) {
  const connected = getConnectedProviderIDs(providers)
  return (
    providers?.all
      .filter((provider) => connected.has(provider.id))
      .flatMap((provider) =>
        getProviderModels(provider, providers.credentials).map((model) => ({
          ...model,
          name: model.name.replace("(latest)", "").trim(),
          provider,
          latest: model.name.includes("(latest)"),
        }))
      ) ?? []
  )
}

function getProviderModels(
  provider: Provider,
  credentials: ProviderCredentialSummary[]
) {
  if (provider.id !== openAICompatibleProviderID)
    return providerCredentialModels(provider, credentials)

  const compatibleCredentials = credentials.filter(
    (credential) => credential.providerId === openAICompatibleProviderID
  )
  if (!compatibleCredentials.length) return Object.values(provider.models)

  return compatibleCredentials
    .map((credential) =>
      openAICompatibleModels(provider, credential, compatibleCredentials)
    )
    .flat()
}

function providerCredentialModels(
  provider: Provider,
  credentials: ProviderCredentialSummary[]
) {
  const providerCredentials = credentials.filter(
    (credential) => credential.providerId === provider.id
  )
  const models = Object.values(provider.models)
  if (!providerCredentials.length) return models

  return providerCredentials.flatMap((credential) =>
    models.map((model) =>
      credentialModel(model, credential, providerCredentials)
    )
  )
}

function credentialModel(
  model: Model,
  credential: ProviderCredentialSummary,
  credentials: ProviderCredentialSummary[]
) {
  return {
    ...model,
    credentialLabel: credential.label,
    credentialDisplayName: credentialLabel(credential),
    showCredentialLabel: credentials.length > 1,
  }
}

function openAICompatibleModels(
  provider: Provider,
  credential: ProviderCredentialSummary,
  credentials: ProviderCredentialSummary[]
) {
  const fallback = provider.models.custom ?? Object.values(provider.models)[0]
  const modelIds = credential.modelIds?.length
    ? credential.modelIds
    : [
        credential.label === defaultCredentialLabel
          ? "custom"
          : credential.label,
      ]
  return modelIds.map((modelId) => ({
    ...fallback,
    id: modelId,
    name: modelId,
    credentialLabel: credential.label,
    credentialDisplayName: credentialLabel(credential),
    showCredentialLabel: duplicateModelId(credentials, modelId),
  }))
}

function duplicateModelId(
  credentials: ProviderCredentialSummary[],
  modelId: string
) {
  return (
    credentials.filter((credential) =>
      credentialModelIds(credential).includes(modelId)
    ).length > 1
  )
}

function credentialLabel(credential: ProviderCredentialSummary) {
  if (credential.label !== defaultCredentialLabel) return credential.label
  return credential.accountId ?? defaultCredentialLabel
}

function credentialModelIds(credential: ProviderCredentialSummary) {
  if (credential.modelIds?.length) return credential.modelIds
  if (
    credential.providerId === openAICompatibleProviderID &&
    credential.label !== defaultCredentialLabel
  ) {
    return [credential.label]
  }
  return []
}

function getConnectedProviderIDs(providers: ProviderListResponse | undefined) {
  const connected = new Set(providers?.connected ?? [])
  for (const credential of providers?.credentials ?? []) {
    connected.add(credential.providerId)
  }
  return connected
}

function groupModels(models: SelectableModel[]) {
  return Array.from(groupModelsByProvider(models).entries())
    .map(([providerID, items]) => getProviderGroup(providerID, items))
    .sort(
      (a, b) =>
        a.rank - b.rank || a.provider.name.localeCompare(b.provider.name)
    )
}

function modelVisible(state: ModelSelectionState, model: SelectableModel) {
  return !state.hidden.some((item) => sameModelKey(item, modelKey(model)))
}

function setHiddenModel(
  hidden: ModelKey[],
  model: SelectableModel,
  visible: boolean
) {
  if (!visible) {
    return [...hidden, modelKey(model)].filter(uniqueModelKey)
  }
  return hidden.filter((item) => !sameModelKey(item, modelKey(model)))
}

function setHiddenProvider(
  hidden: ModelKey[],
  models: SelectableModel[],
  providerID: string,
  visible: boolean
) {
  if (visible) return hidden.filter((item) => item.providerID !== providerID)
  return [
    ...hidden,
    ...models.filter((model) => model.provider.id === providerID).map(modelKey),
  ].filter(uniqueModelKey)
}

function uniqueModelKey(value: ModelKey, index: number, list: ModelKey[]) {
  return list.findIndex((item) => sameModelKey(item, value)) === index
}

function groupModelsByProvider(models: SelectableModel[]) {
  return models.reduce((groups, model) => {
    groups.set(model.provider.id, [
      ...(groups.get(model.provider.id) ?? []),
      model,
    ])
    return groups
  }, new Map<string, SelectableModel[]>())
}

function getProviderGroup(providerID: string, items: SelectableModel[]) {
  return {
    provider: items[0].provider,
    models: [...items].sort((a, b) => a.name.localeCompare(b.name)),
    rank: getProviderRank(providerID),
  }
}

function getDefaultModel(
  models: SelectableModel[],
  providers: ProviderListResponse | undefined
) {
  if (!providers) return models[0]

  const configured = providers.connected
    .map((providerID) => getDefaultModelKey(providers, providerID))
    .map((key) => findModel(models, key))
    .find(Boolean)

  return configured ?? models[0]
}

function getDefaultModelKey(
  providers: ProviderListResponse,
  providerID: string
) {
  return {
    providerID,
    modelID: providers.default[providerID],
  }
}

function getCurrentVariant(
  model: SelectableModel | undefined,
  variant: string | null | undefined
) {
  if (!variant) return undefined
  if (!isReasoningEffort(variant)) return undefined
  if (!model?.variants || !(variant in model.variants)) return undefined
  return variant
}

function getVariantOptions(model: SelectableModel | undefined) {
  return [defaultVariant, ...Object.keys(model?.variants ?? {})]
}

function getVariantLabel(variant: string) {
  if (variant === defaultVariant) return "Default"
  if (variant === "xhigh") return "X High"
  return variant
}

function contextCompressionMode(
  value: string
): AgentContextCompressionMode {
  if (value === "headroom" || value === "off") return value
  return "cline"
}

function readContextCompressionMode(): AgentContextCompressionMode {
  return contextCompressionMode(
    localStorage.getItem(contextCompressionStorageKey) ??
      defaultContextCompressionMode
  )
}

function isReasoningEffort(value: string): value is ReasoningEffort {
  return (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  )
}

function getEmptyMessage(input: {
  directory: string | undefined
  failed: boolean
  loading: boolean
  serverReady: boolean
}) {
  if (!input.serverReady) return "Sidecar unavailable"
  if (input.loading) return "Loading models"
  if (input.failed) return "Unable to load models"
  return "No models found"
}

function findModel(models: SelectableModel[], key: ModelKey | undefined) {
  return models.find((model) => key && sameModelKey(modelKey(model), key))
}

function isModelSelected(
  current: SelectableModel | undefined,
  model: SelectableModel
) {
  return Boolean(current && sameModelKey(modelKey(current), modelKey(model)))
}

function pushRecent(recent: ModelKey[], model: SelectableModel) {
  const key = modelKey(model)
  return [key, ...recent.filter((item) => !sameModelKey(item, key))].slice(
    0,
    recentLimit
  )
}

function modelKey(model: SelectableModel): ModelKey {
  return {
    providerID: model.provider.id,
    modelID: model.id,
    credentialLabel: model.credentialLabel,
  }
}

function sameModelKey(left: ModelKey, right: ModelKey) {
  return (
    left.providerID === right.providerID &&
    left.modelID === right.modelID &&
    (left.credentialLabel ?? defaultCredentialLabel) ===
      (right.credentialLabel ?? defaultCredentialLabel)
  )
}

function readModelState(directory: string | undefined): ModelSelectionState {
  if (!directory) return { recent: [], hidden: [] }

  const parsed = readStoredStates()
  return isModelState(parsed[directory])
    ? { ...parsed[directory], hidden: parsed[directory].hidden ?? [] }
    : { recent: [], hidden: [] }
}

function writeState(directory: string | undefined, state: ModelSelectionState) {
  if (!directory) return

  const parsed = readStoredStates()
  localStorage.setItem(
    storageKey,
    JSON.stringify({ ...parsed, [directory]: state })
  )
}

function setModelState(
  directory: string | undefined,
  setState: (state: ModelSelectionState) => void,
  state: ModelSelectionState
) {
  writeState(directory, state)
  setState(readModelState(directory))
  notifyModelStateListeners()
}

function notifyModelStateListeners() {
  for (const listener of modelStateListeners) listener()
}

function readStoredStates(): Record<string, unknown> {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "{}")
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function isModelState(value: unknown): value is ModelSelectionState {
  if (!value || typeof value !== "object") return false
  if (!("recent" in value) || !Array.isArray(value.recent)) return false
  if ("hidden" in value && !Array.isArray(value.hidden)) return false
  const state = value as { recent: unknown[]; hidden?: unknown[] }
  return (
    state.recent.every(isModelKey) && (state.hidden ?? []).every(isModelKey)
  )
}

function isModelKey(value: unknown): value is ModelKey {
  if (!value || typeof value !== "object") return false
  if (!("providerID" in value) || typeof value.providerID !== "string")
    return false
  if (!("modelID" in value) || typeof value.modelID !== "string") return false
  return (
    !("credentialLabel" in value) ||
    value.credentialLabel === undefined ||
    typeof value.credentialLabel === "string"
  )
}

function getProviderRank(providerID: string) {
  const index = popularProviders.indexOf(providerID)
  return index === -1 ? popularProviders.length : index
}
