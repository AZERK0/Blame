import type { RuntimeProfileId } from "@blame/preview-runtime"
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CloudIcon,
  ContainerIcon,
  type LucideIcon,
} from "lucide-react"
import * as React from "react"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { useCloudAuth } from "@/context/cloud-auth"
import { usePlatform } from "@/context/platform"
import {
  runtimeProfileSwitchBlockReason,
  saveRuntimePreference,
  useRuntimePreference,
} from "@/lib/runtime-preference"
import { cn } from "@/lib/utils"

type RuntimeOption = {
  description: string
  icon: LucideIcon
  iconClassName: string
  iconStyle?: React.CSSProperties
  label: string
  profile: RuntimeProfileId
  selectedClassName: string
  triggerClassName: string
  triggerStyle?: React.CSSProperties
}

const cloudGradient = {
  background:
    "linear-gradient(color-mix(in oklch, var(--muted) 68%, var(--background)), color-mix(in oklch, var(--muted) 68%, var(--background))) padding-box, linear-gradient(135deg, oklch(0.8 0.16 240 / 52%), oklch(0.7 0.21 245 / 52%), oklch(0.62 0.22 255 / 42%)) border-box",
  backgroundClip: "padding-box, border-box",
} satisfies React.CSSProperties

const runtimeOptions = [
  {
    description: "Run the story in an isolated managed sandbox.",
    icon: CloudIcon,
    iconClassName:
      "border border-transparent bg-transparent text-sky-600 shadow-[0_0_0_1px_oklch(0.7_0.17_250_/_0.1),0_0_8px_oklch(0.65_0.2_250_/_0.1)] ring-1 ring-foreground/15 dark:text-sky-300",
    iconStyle: cloudGradient,
    label: "Cloud Preview",
    profile: "vercel-compose",
    selectedClassName: "text-sky-600 dark:text-sky-300",
    triggerClassName:
      "border-transparent bg-transparent text-foreground shadow-[0_0_0_1px_oklch(0.7_0.17_250_/_0.12),0_0_8px_oklch(0.65_0.2_250_/_0.12)] ring-1 ring-foreground/20 transition-[filter] duration-150 hover:brightness-105 focus-visible:ring-2 focus-visible:ring-sky-300/80",
    triggerStyle: cloudGradient,
  },
  {
    description: "Run the story with containers on this machine.",
    icon: ContainerIcon,
    iconClassName:
      "bg-muted/70 text-muted-foreground ring-1 ring-foreground/10",
    label: "Local Container",
    profile: "local-container",
    selectedClassName: "text-foreground",
    triggerClassName:
      "bg-muted/70 text-foreground shadow-none ring-0 transition-colors hover:bg-muted",
  },
] as const satisfies readonly RuntimeOption[]

export const RuntimeProfileSelector = React.memo(
  function RuntimeProfileSelector() {
    const auth = useCloudAuth()
    const platform = usePlatform()
    const preference = useRuntimePreference()
    const [open, setOpen] = React.useState(false)
    const cloudAvailable = Boolean(
      platform.previewRuntime && auth.status === "authenticated"
    )
    const selected = runtimeOption(preference.profile)

    const selectProfile = (profile: RuntimeProfileId) => {
      if (profile === preference.profile) {
        setOpen(false)
        return
      }
      const switchBlocked = runtimeProfileSwitchBlockReason(profile)
      if (switchBlocked) {
        window.alert(switchBlocked)
        return
      }
      if (profile === "local-container") {
        saveRuntimePreference({ profile, source: "account-default" })
        setOpen(false)
        return
      }
      if (!cloudAvailable) return
      saveRuntimePreference({
        profile,
        source: "account-default",
        confirmedCloudUploadAt: new Date().toISOString(),
      })
      setOpen(false)
    }

    const SelectedIcon = selected.icon

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            aria-label={`Preview runtime: ${selected.label}`}
            className={cn(
              "h-8 w-44 justify-between gap-2 rounded-xl px-3 text-sm font-medium active:translate-y-0",
              selected.triggerClassName
            )}
            style={selected.triggerStyle}
          >
            <span className="flex min-w-0 items-center gap-2">
              <SelectedIcon className="size-4 shrink-0" />
              <span className="truncate">{selected.label}</span>
            </span>
            {open ? (
              <ChevronUpIcon className="size-4 shrink-0 opacity-70" />
            ) : (
              <ChevronDownIcon className="size-4 shrink-0 opacity-70" />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="top"
          sideOffset={6}
          className="w-80 rounded-xl p-2"
        >
          <div className="space-y-0.5">
            {runtimeOptions.map((option) => (
              <RuntimeProfileOption
                disabled={
                  option.profile === "vercel-compose" && !cloudAvailable
                }
                key={option.profile}
                option={option}
                selected={option.profile === preference.profile}
                onSelect={selectProfile}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>
    )
  }
)

function RuntimeProfileOption({
  disabled,
  onSelect,
  option,
  selected,
}: {
  disabled: boolean
  onSelect: (profile: RuntimeProfileId) => void
  option: RuntimeOption
  selected: boolean
}) {
  const Icon = option.icon

  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-foreground/10 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
      disabled={disabled}
      onClick={() => onSelect(option.profile)}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          option.iconClassName
        )}
        style={option.iconStyle}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{option.label}</span>
        <span className="block text-xs text-muted-foreground">
          {disabled
            ? "Sign in from the desktop app to use cloud previews."
            : option.description}
        </span>
      </span>
      {selected ? (
        <CheckIcon
          className={cn("size-4 shrink-0", option.selectedClassName)}
        />
      ) : null}
    </button>
  )
}

function runtimeOption(profile: RuntimeProfileId): RuntimeOption {
  return (
    runtimeOptions.find((option) => option.profile === profile) ??
    runtimeOptions[1]
  )
}
