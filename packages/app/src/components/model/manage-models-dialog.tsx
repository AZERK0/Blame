import { CheckIcon, PlusIcon } from "lucide-react"

import {
  ModelTags,
  ProviderMark,
  type ModelGroup,
  type ModelSelection,
  type SelectableModel,
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

export function ManageModelsDialog({
  onConnectProvider,
  onOpenChange,
  open,
  selection,
}: {
  onConnectProvider: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
  selection: ModelSelection
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="px-4 pt-4">
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="grid gap-2">
              <DialogTitle>Manage models</DialogTitle>
              <DialogDescription>
                Choose which connected models appear in the selector.
              </DialogDescription>
            </div>
            <Button size="sm" variant="outline" onClick={onConnectProvider}>
              <PlusIcon />
              Connect
            </Button>
          </div>
        </DialogHeader>
        <Command>
          <CommandInput placeholder="Search models" />
          <CommandList className="max-h-[26rem] overscroll-contain">
            <CommandEmpty>No models found</CommandEmpty>
            {selection.allProviderGroups.map((group) => (
              <CommandGroup
                key={group.provider.id}
                heading={group.provider.name}
                className="[&_[cmdk-group-heading]]:flex [&_[cmdk-group-heading]]:items-center [&_[cmdk-group-heading]]:justify-between"
              >
                <ProviderVisibilityItem group={group} selection={selection} />
                {group.models.map((model) => (
                  <ModelVisibilityItem
                    key={`${model.provider.id}:${model.id}`}
                    model={model}
                    selection={selection}
                  />
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

function ProviderVisibilityItem({
  group,
  selection,
}: {
  group: ModelGroup
  selection: ModelSelection
}) {
  return (
    <CommandItem
      value={`${group.provider.name} provider visibility`}
      onSelect={() =>
        selection.setProviderVisible(
          group.provider.id,
          !selection.providerVisible(group.provider.id)
        )
      }
    >
      <ProviderMark provider={group.provider} />
      <span className="min-w-0 flex-1 truncate">{group.provider.name}</span>
      <Badge variant="outline">Provider</Badge>
      <VisibilityCheck visible={selection.providerVisible(group.provider.id)} />
    </CommandItem>
  )
}

function ModelVisibilityItem({
  model,
  selection,
}: {
  model: SelectableModel
  selection: ModelSelection
}) {
  const visible = selection.modelVisible(model)

  return (
    <CommandItem
      value={`${model.provider.name} ${model.name} ${model.id}`}
      onSelect={() => selection.setModelVisible(model, !visible)}
    >
      <span className="size-5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{model.name}</span>
      <ModelTags model={model} />
      <VisibilityCheck visible={visible} />
    </CommandItem>
  )
}

function VisibilityCheck({ visible }: { visible: boolean }) {
  return (
    <span className="ml-auto flex size-4 items-center justify-center">
      {visible ? <CheckIcon className="size-4" /> : null}
    </span>
  )
}
