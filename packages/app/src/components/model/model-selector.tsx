import {
  ChevronsUpDownIcon,
  PlusIcon,
  SlidersHorizontalIcon,
} from "lucide-react"
import * as React from "react"
import type {
  BlameModel as Model,
  BlameProvider as Provider,
  ModelRecommendation,
  ProviderCredentialSummary,
  ProviderListResponse,
  ReasoningEffort,
} from "@blame/agent-runtime"

import {
  ConnectProviderDialog,
  ProviderSelectDialog,
} from "@/components/model/connect-provider-dialog"
import { ManageModelsDialog } from "@/components/model/manage-models-dialog"
import { iconNames, type IconName } from "@/components/provider-icons/types"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
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
const globalModelSelectionKey = "__global__"
const recentLimit = 5
const defaultVariant = "default"
const defaultContextCompressionMode = "cline"
const defaultCredentialLabel = "default"
const openAICompatibleProviderID = "openai-compatible"
const allProvidersValue = "all"
const providerIconSprite = new URL(
  "../provider-icons/sprite.svg",
  import.meta.url
).href
const providerIconAliases: Partial<Record<string, IconName>> = {
  "openai-codex": "openai",
  "openai-native": "openai",
}
const modelStateListeners = new Set<() => void>()
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
  accounts: Record<string, string>
}

export type RecommendedSelectableModel = ModelRecommendation & {
  model: SelectableModel
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
  const [advanced, setAdvanced] = React.useState(false)
  const [providerID, setProviderID] = React.useState(allProvidersValue)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <ModelPickerTrigger selection={selection} />
      <ModelPickerContent
        advanced={advanced}
        providerID={providerID}
        selection={selection}
        setAdvanced={setAdvanced}
        setDialog={setDialog}
        setOpen={setOpen}
        setProviderID={setProviderID}
      />
    </Popover>
  )
}

function ModelPickerTrigger({ selection }: { selection: ModelSelection }) {
  return (
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
  )
}

type ModelPickerContentProps = {
  advanced: boolean
  providerID: string
  selection: ModelSelection
  setAdvanced: (value: boolean) => void
  setDialog: (dialog: ModelDialog) => void
  setOpen: (value: boolean) => void
  setProviderID: (value: string) => void
}

function ModelPickerContent(props: ModelPickerContentProps) {
  const openDialog = (type: "providers" | "manage") => {
    props.setOpen(false)
    props.setDialog({ type })
  }
  return (
    <PopoverContent
      align="start"
      side="left"
      className="w-88 overflow-hidden p-0"
      onWheel={(event) => event.stopPropagation()}
    >
      <ModelPickerPanel {...props} />
      <ModelPickerFooter
        onConnect={() => openDialog("providers")}
        onManage={() => openDialog("manage")}
      />
    </PopoverContent>
  )
}

type ModelPickerPanelProps = {
  advanced: boolean
  providerID: string
  selection: ModelSelection
  setAdvanced: (value: boolean) => void
  setProviderID: (value: string) => void
}

function ModelPickerPanel({
  advanced,
  providerID,
  selection,
  setAdvanced,
  setProviderID,
}: ModelPickerPanelProps) {
  return (
    <div className="space-y-4 p-4">
      <ProviderFilter
        providerID={providerID}
        providers={selection.connectedProviders}
        onChange={(value) => changeProvider(selection, value, setProviderID)}
      />
      {advanced ? (
        <AdvancedModelPicker providerID={providerID} selection={selection} />
      ) : (
        <SmartModelSlider
          key={`${providerID}:${selection.currentModel?.provider.id}:${selection.currentModel?.id}`}
          providerID={providerID}
          selection={selection}
        />
      )}
      <ModelPickerModeToggle advanced={advanced} onChange={setAdvanced} />
    </div>
  )
}

function changeProvider(
  selection: ModelSelection,
  providerID: string,
  setProviderID: (value: string) => void
) {
  setProviderID(providerID)
  selectProviderRecommendation(selection, providerID)
}

function ModelPickerModeToggle({
  advanced,
  onChange,
}: {
  advanced: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <button
      className="ml-auto block text-xs text-muted-foreground transition-colors hover:text-foreground"
      type="button"
      onClick={() => onChange(!advanced)}
    >
      {advanced ? "Smart selection" : "Advanced"}
    </button>
  )
}

type ProviderFilterProps = {
  providerID: string
  providers: Provider[]
  onChange: (value: string) => void
}

function ProviderFilter({
  providerID,
  providers,
  onChange,
}: ProviderFilterProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium">Provider</span>
      <Select value={providerID} onValueChange={onChange}>
        <SelectTrigger
          aria-label="Filter model provider"
          className="h-7 max-w-48 border-0 bg-transparent px-1.5 shadow-none"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start">
          <SelectItem value={allProvidersValue}>All</SelectItem>
          {providers.map((provider) => (
            <SelectItem key={provider.id} value={provider.id}>
              {provider.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

type SmartModelSliderProps = {
  providerID: string
  selection: ModelSelection
}

function SmartModelSlider({ providerID, selection }: SmartModelSliderProps) {
  const recommendations = selection.recommendedModels(providerID)
  const [position, setPosition] = React.useState(() =>
    recommendationPosition(recommendations, selection.currentModel)
  )
  const selected = nearestRecommendation(recommendations, position)
  const boundary = selection.recommendations?.benchmarkBoundary ?? 0.74

  if (!recommendations.length) {
    return <EmptySmartModelSlider />
  }

  return (
    <div className="space-y-3">
      <SliderLabels
        boundary={boundary}
        hasUnbenchmarked={recommendations.some(isUnbenchmarked)}
      />
      <SmartSliderInput
        boundary={boundary}
        position={position}
        recommendations={recommendations}
        select={() => selectRecommendation(selection, selected)}
        setPosition={setPosition}
      />
      <SmartModelSelection selected={selected} selection={selection} />
    </div>
  )
}

function SmartModelSelection({
  selected,
  selection,
}: {
  selected: RecommendedSelectableModel | undefined
  selection: ModelSelection
}) {
  return (
    <ModelAccountSelector
      providerID={selected?.providerId}
      selection={selection}
    />
  )
}

function EmptySmartModelSlider() {
  return (
    <div className="py-8 text-center text-sm text-muted-foreground">
      No ranked models
    </div>
  )
}

type SmartSliderInputProps = {
  boundary: number
  position: number
  recommendations: RecommendedSelectableModel[]
  select: () => void
  setPosition: (position: number) => void
}

function SmartSliderInput(props: SmartSliderInputProps) {
  return (
    <div className="relative">
      <input
        aria-label="Model cost and intelligence"
        className="h-3 w-full cursor-pointer appearance-none rounded-full accent-primary [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-foreground [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground"
        max={1000}
        min={0}
        style={{ background: sliderBackground(props.position) }}
        type="range"
        value={Math.round(props.position * 1000)}
        onBlur={props.select}
        onChange={(event) =>
          props.setPosition(Number(event.currentTarget.value) / 1000)
        }
        onKeyUp={props.select}
        onPointerUp={props.select}
      />
      <SliderMarkers {...props} />
      <SliderBoundary position={props.boundary} />
    </div>
  )
}

function SliderBoundary({ position }: { position: number }) {
  return (
    <span
      className="pointer-events-none absolute top-1/2 h-5 w-px -translate-y-1/2 bg-background/80"
      style={{ left: `${position * 100}%` }}
    />
  )
}

function SliderLabels({
  boundary,
  hasUnbenchmarked,
}: {
  boundary: number
  hasUnbenchmarked: boolean
}) {
  return (
    <div className="relative h-7 text-xs text-muted-foreground">
      <span className="absolute bottom-0 left-0">Cheaper</span>
      <span
        className="absolute bottom-0"
        style={{ right: `calc(${(1 - boundary) * 100}% + 0.5rem)` }}
      >
        Smarter
      </span>
      {hasUnbenchmarked ? (
        <span className="absolute -top-1 right-0 flex flex-col text-right leading-3">
          <span>New</span>
          <span>No benchmark</span>
        </span>
      ) : null}
    </div>
  )
}

function SliderMarkers({
  position,
  recommendations,
}: {
  position: number
  recommendations: RecommendedSelectableModel[]
}) {
  return recommendations.map((recommendation) =>
    Math.abs(recommendation.position - position) < 0.025 ? null : (
      <span
        key={`${recommendation.providerId}:${recommendation.modelId}`}
        className="pointer-events-none absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/25"
        style={{ left: `${recommendation.position * 100}%` }}
      />
    )
  )
}

function sliderBackground(position: number) {
  const progress = `${position * 100}%`
  return `linear-gradient(to right, var(--primary) 0 ${progress}, var(--muted) ${progress} 100%)`
}

function AdvancedModelPicker({
  providerID,
  selection,
}: {
  providerID: string
  selection: ModelSelection
}) {
  const groups = selection.providerGroups.filter(
    (group) =>
      providerID === allProvidersValue || group.provider.id === providerID
  )
  const accountProviderID =
    providerID === allProvidersValue
      ? selection.currentModel?.provider.id
      : providerID

  return (
    <div className="space-y-3">
      <ModelAccountSelector
        providerID={accountProviderID}
        selection={selection}
        alwaysVisible
      />
      <AdvancedModelSelect groups={groups} selection={selection} />
    </div>
  )
}

function AdvancedModelSelect({
  groups,
  selection,
}: {
  groups: ModelGroup[]
  selection: ModelSelection
}) {
  const value = selection.currentModel
    ? modelOptionValue(selection.currentModel)
    : undefined
  return (
    <Select
      value={value}
      onValueChange={(next) => selectAdvancedModel(selection, next)}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select model" />
      </SelectTrigger>
      <SelectContent>
        {groups.map((group, index) => (
          <AdvancedModelGroup
            group={group}
            key={group.provider.id}
            separated={index > 0}
          />
        ))}
      </SelectContent>
    </Select>
  )
}

function AdvancedModelGroup({
  group,
  separated,
}: {
  group: ModelGroup
  separated: boolean
}) {
  return (
    <>
      {separated ? <SelectSeparator /> : null}
      <SelectGroup>
        <SelectLabel>{group.provider.name}</SelectLabel>
        {group.models.map((model) => (
          <SelectItem
            key={modelReactKey(model)}
            value={modelOptionValue(model)}
          >
            {model.name}
          </SelectItem>
        ))}
      </SelectGroup>
    </>
  )
}

type ModelAccountSelectorProps = {
  alwaysVisible?: boolean
  providerID: string | undefined
  selection: ModelSelection
}

function ModelAccountSelector({
  alwaysVisible = false,
  providerID,
  selection,
}: ModelAccountSelectorProps) {
  if (!providerID) return null
  const accounts = selection.accountsForProvider(providerID)
  if (!accounts.length || (!alwaysVisible && accounts.length < 2)) return null
  return (
    <div className="grid grid-cols-[4.5rem_1fr] items-center gap-2">
      <span className="text-xs text-muted-foreground">Account</span>
      <Select
        value={selection.selectedAccountLabel(providerID)}
        onValueChange={(label) => void selection.setAccount(providerID, label)}
      >
        <SelectTrigger className="w-full" disabled={accounts.length === 1}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((account) => (
            <SelectItem key={account.id} value={account.label}>
              {credentialLabel(account)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function ModelPickerFooter({
  onConnect,
  onManage,
}: {
  onConnect: () => void
  onManage: () => void
}) {
  return (
    <div className="flex items-center justify-end border-t p-1">
      <Button size="icon-sm" variant="ghost" onClick={onConnect}>
        <PlusIcon />
        <span className="sr-only">Connect provider</span>
      </Button>
      <Button size="icon-sm" variant="ghost" onClick={onManage}>
        <SlidersHorizontalIcon />
        <span className="sr-only">Manage models</span>
      </Button>
    </div>
  )
}

function recommendationPosition(
  recommendations: RecommendedSelectableModel[],
  currentModel: SelectableModel | undefined
) {
  const current = recommendations.find(
    (recommendation) =>
      recommendation.providerId === currentModel?.provider.id &&
      recommendation.modelId === currentModel?.id
  )
  return current?.position ?? recommendations[0]?.position ?? 0
}

function nearestRecommendation(
  recommendations: RecommendedSelectableModel[],
  position: number
) {
  return recommendations.reduce<RecommendedSelectableModel | undefined>(
    (nearest, candidate) => {
      if (!nearest) return candidate
      const currentDistance = Math.abs(nearest.position - position)
      return Math.abs(candidate.position - position) < currentDistance
        ? candidate
        : nearest
    },
    undefined
  )
}

function selectRecommendation(
  selection: ModelSelection,
  recommendation: RecommendedSelectableModel | undefined
) {
  if (!recommendation) return
  if (isModelSelected(selection.currentModel, recommendation.model)) return
  void selection.setModel(recommendation.model)
}

function selectProviderRecommendation(
  selection: ModelSelection,
  providerID: string
) {
  const currentPosition = recommendationPosition(
    selection.recommendedModels(allProvidersValue),
    selection.currentModel
  )
  selectRecommendation(
    selection,
    nearestRecommendation(
      selection.recommendedModels(providerID),
      currentPosition
    )
  )
}

function isUnbenchmarked(recommendation: RecommendedSelectableModel) {
  return recommendation.segment === "unbenchmarked"
}

function modelOptionValue(model: SelectableModel) {
  return `${model.provider.id}\u0001${model.id}`
}

function selectAdvancedModel(selection: ModelSelection, value: string) {
  const model = selection.models.find(
    (candidate) => modelOptionValue(candidate) === value
  )
  if (model) void selection.setModel(model)
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
        {model.provider.name} · {modelDisplayName(model)}
      </span>
    </span>
  )
}

export function modelDisplayName(model: SelectableModel) {
  return model.name
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
  const icon = providerIconName(provider.id)

  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted/60">
      <svg
        aria-label={provider.name}
        className="size-4"
        data-component="provider-icon"
        role="img"
      >
        <use href={`${providerIconSprite}#${icon}`} />
      </svg>
    </span>
  )
}

function providerIconName(providerID: string): IconName {
  const icon = providerIconAliases[providerID] ?? providerID
  return iconNames.includes(icon as IconName) ? (icon as IconName) : "synthetic"
}

export function useModelSelection(options: ModelSelectionOptions = {}) {
  const providerState = useProviderState()
  const role = options.role ?? "agent"
  const [state, setState] = React.useState(() =>
    readModelState(providerState.directory)
  )

  React.useEffect(() => {
    const refreshState = () => setState(readModelState(providerState.directory))
    const handleStorageChange = (event: StorageEvent) => {
      if (event.storageArea === localStorage && event.key === storageKey) {
        refreshState()
      }
    }

    refreshState()
    modelStateListeners.add(refreshState)
    window.addEventListener("storage", handleStorageChange)

    return () => {
      modelStateListeners.delete(refreshState)
      window.removeEventListener("storage", handleStorageChange)
    }
  }, [providerState.directory])

  const preference = modelPreference(providerState.aiPreferences, role)
  const accountLabels = React.useMemo(
    () => selectedAccountLabels(state, preference),
    [preference, state]
  )
  const models = React.useMemo(
    () => getModels(providerState.providers, accountLabels),
    [providerState.providers, accountLabels]
  )
  const visibleModels = React.useMemo(
    () => models.filter((model) => modelVisible(state, model)),
    [models, state]
  )
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
    connectedProviders: connectedProviders(providerState.providers),
    credentials: providerState.providers?.credentials ?? [],
    connectedProviderIDs: getConnectedProviderIDs(providerState.providers),
    contextCompressionMode: defaultContextCompressionMode,
    currentModel,
    currentVariant,
    directory: providerState.directory,
    emptyMessage: getEmptyMessage(providerState),
    providerGroups: groupModels(visibleModels),
    models: visibleModels,
    recommendations: providerState.providers?.recommendations,
    refreshProviders: providerState.refresh,
    serverReady: providerState.serverReady,
    variantOptions: getVariantOptions(currentModel),
    role,
    saveAiPreferences: providerState.saveAiPreferences,
    setModel: async (model: SelectableModel) => {
      setModelState(providerState.directory, setState, {
        ...state,
        accounts: model.credentialLabel
          ? { ...state.accounts, [model.provider.id]: model.credentialLabel }
          : state.accounts,
        recent: pushRecent(state.recent, model),
        hidden: state.hidden.filter(
          (item) => !sameCatalogModelKey(item, modelKey(model))
        ),
      })
      await saveRolePreference(
        providerState,
        role,
        modelPreferenceInput(model, preference?.reasoningEffort)
      )
    },
    accountsForProvider: (providerID: string) =>
      providerAccounts(providerState.providers, providerID),
    selectedAccountLabel: (providerID: string) =>
      selectedAccountLabel(providerState.providers, accountLabels, providerID),
    setAccount: async (providerID: string, label: string) => {
      const nextAccounts = { ...accountLabels, [providerID]: label }
      const nextModels = getModels(providerState.providers, nextAccounts)
      const target = accountTargetModel(nextModels, currentModel, providerID)
      setModelState(providerState.directory, setState, {
        ...state,
        accounts: nextAccounts,
      })
      if (target) {
        await saveRolePreference(
          providerState,
          role,
          modelPreferenceInput(target, preference?.reasoningEffort)
        )
      }
    },
    recommendedModels: (providerID: string) =>
      recommendedModels(providerState.providers, visibleModels, providerID),
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
        reasoningEffort: reasoningEffortValue(variant),
      }),
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

function modelPreferenceInput(
  model: SelectableModel,
  reasoningEffort: string | null | undefined
): CloudAiModelPreference {
  return {
    providerId: model.provider.id,
    modelId: model.id,
    credentialLabel: model.credentialLabel ?? null,
    reasoningEffort: supportedReasoningEffort(model, reasoningEffort),
  }
}

function supportedReasoningEffort(
  model: SelectableModel,
  value: string | null | undefined
) {
  const effort = reasoningEffortValue(value)
  return effort && model.variants?.[effort] ? effort : null
}

function reasoningEffortValue(value: string | null | undefined) {
  return value && isReasoningEffort(value) ? value : null
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

function getModels(
  providers: ProviderListResponse | undefined,
  accountLabels: Record<string, string>
) {
  const connected = getConnectedProviderIDs(providers)
  return (
    providers?.all
      .filter((provider) => connected.has(provider.id))
      .flatMap((provider) =>
        getProviderModels(
          provider,
          providers.credentials,
          accountLabels[provider.id]
        ).map((model) => selectableModel(provider, model))
      ) ?? []
  )
}

function getProviderModels(
  provider: Provider,
  credentials: ProviderCredentialSummary[],
  accountLabel: string | undefined
) {
  const credential = selectedProviderCredential(
    credentials,
    provider.id,
    accountLabel
  )
  if (provider.id === openAICompatibleProviderID && credential) {
    return openAICompatibleModels(provider, credential)
  }
  return Object.values(provider.models).map((model) =>
    credential ? credentialModel(model, credential) : model
  )
}

function selectedProviderCredential(
  credentials: ProviderCredentialSummary[],
  providerID: string,
  accountLabel: string | undefined
) {
  const accounts = credentials.filter(
    (credential) => credential.providerId === providerID
  )
  return (
    accounts.find((credential) => credential.label === accountLabel) ??
    accounts[0]
  )
}

function selectableModel(
  provider: Provider,
  model: Model & {
    credentialLabel?: string
    credentialDisplayName?: string
  }
) {
  return {
    ...model,
    name: model.name.replace("(latest)", "").trim(),
    provider,
    latest: model.name.includes("(latest)"),
  }
}

function credentialModel(model: Model, credential: ProviderCredentialSummary) {
  return {
    ...model,
    credentialLabel: credential.label,
    credentialDisplayName: credentialLabel(credential),
  }
}

function openAICompatibleModels(
  provider: Provider,
  credential: ProviderCredentialSummary
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
  }))
}

function credentialLabel(credential: ProviderCredentialSummary) {
  if (credential.label !== defaultCredentialLabel) return credential.label
  return credential.accountId ?? defaultCredentialLabel
}

function selectedAccountLabels(
  state: ModelSelectionState,
  preference: CloudAiModelPreference | undefined
) {
  const labels = { ...state.accounts }
  if (preference?.credentialLabel) {
    labels[preference.providerId] ??= preference.credentialLabel
  }
  return labels
}

function selectedAccountLabel(
  providers: ProviderListResponse | undefined,
  accountLabels: Record<string, string>,
  providerID: string
) {
  const accounts = providerAccounts(providers, providerID)
  return (
    accounts.find((account) => account.label === accountLabels[providerID])
      ?.label ??
    accounts[0]?.label ??
    defaultCredentialLabel
  )
}

function providerAccounts(
  providers: ProviderListResponse | undefined,
  providerID: string
) {
  return (providers?.credentials ?? []).filter(
    (credential) => credential.providerId === providerID
  )
}

function accountTargetModel(
  models: SelectableModel[],
  currentModel: SelectableModel | undefined,
  providerID: string
) {
  const providerModels = models.filter(
    (model) => model.provider.id === providerID
  )
  return (
    providerModels.find((model) => model.id === currentModel?.id) ??
    providerModels[0]
  )
}

function getConnectedProviderIDs(providers: ProviderListResponse | undefined) {
  const connected = new Set(providers?.connected ?? [])
  for (const credential of providers?.credentials ?? []) {
    connected.add(credential.providerId)
  }
  return connected
}

function connectedProviders(providers: ProviderListResponse | undefined) {
  const connected = getConnectedProviderIDs(providers)
  return (providers?.all ?? []).filter((provider) => connected.has(provider.id))
}

function recommendedModels(
  providers: ProviderListResponse | undefined,
  models: SelectableModel[],
  providerID: string
) {
  const recommendations =
    providerID === allProvidersValue
      ? providers?.recommendations.all
      : providers?.recommendations.byProvider[providerID]
  return (recommendations ?? [])
    .map((recommendation) => ({
      ...recommendation,
      model: models.find(
        (model) =>
          model.provider.id === recommendation.providerId &&
          model.id === recommendation.modelId
      ),
    }))
    .filter(
      (
        recommendation
      ): recommendation is ModelRecommendation & { model: SelectableModel } =>
        recommendation.model !== undefined
    )
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
  return !state.hidden.some((item) =>
    sameCatalogModelKey(item, modelKey(model))
  )
}

function setHiddenModel(
  hidden: ModelKey[],
  model: SelectableModel,
  visible: boolean
) {
  if (!visible) {
    return [...hidden, modelKey(model)].filter(uniqueCatalogModelKey)
  }
  return hidden.filter((item) => !sameCatalogModelKey(item, modelKey(model)))
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
  ].filter(uniqueCatalogModelKey)
}

function uniqueCatalogModelKey(
  value: ModelKey,
  index: number,
  list: ModelKey[]
) {
  return list.findIndex((item) => sameCatalogModelKey(item, value)) === index
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

function sameCatalogModelKey(left: ModelKey, right: ModelKey) {
  return left.providerID === right.providerID && left.modelID === right.modelID
}

function readModelState(directory: string | undefined): ModelSelectionState {
  if (!directory) return { recent: [], hidden: [], accounts: {} }

  const parsed = readStoredStates()
  return isModelState(parsed[directory])
    ? {
        ...parsed[directory],
        hidden: parsed[directory].hidden ?? [],
        accounts: parsed[directory].accounts ?? {},
      }
    : { recent: [], hidden: [], accounts: {} }
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
  if (
    "accounts" in value &&
    (!value.accounts ||
      typeof value.accounts !== "object" ||
      !Object.values(value.accounts).every((item) => typeof item === "string"))
  )
    return false
  const state = value as {
    recent: unknown[]
    hidden?: unknown[]
    accounts?: Record<string, string>
  }
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
