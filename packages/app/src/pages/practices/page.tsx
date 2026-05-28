import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { useCodePracticesStore } from "@/components/practices/data/code-practices-store"
import { cn } from "@/lib/utils"
import type {
  CodePractice,
  CodePracticeKey,
} from "@/components/practices/data/code-practices-data"

const practiceLabels: Record<CodePracticeKey, string> = {
  coding_style: "Coding style",
  unit_tests: "Unit tests",
  layered_architecture: "Layered architecture",
  commit_message_convention: "Commit message convention",
}

const practiceDescriptions: Record<CodePracticeKey, string> = {
  coding_style:
    "Apply the project's formatting, linting, typing, and naming conventions.",
  unit_tests:
    "Ask the agent to preserve and extend fast automated tests around changes.",
  layered_architecture:
    "Keep responsibilities separated across UI, business logic, and data access.",
  commit_message_convention:
    "Guide the agent to follow the repository's commit message convention.",
}

export function PracticesPage() {
  const store = useCodePracticesStore()

  return (
    <div className="flex flex-1 flex-col items-center p-4 lg:p-6">
      <div className="flex w-full max-w-3xl flex-col gap-4">
        <h2 className="font-heading text-2xl font-semibold tracking-normal">
          Code practices
        </h2>
        {store.loading ? <PracticesLoading /> : null}
        {!store.loading && store.error ? (
          <Alert variant="destructive">
            <AlertDescription>{store.error}</AlertDescription>
          </Alert>
        ) : null}
        {!store.loading && !store.error && !store.practices.length ? (
          <Alert>
            <AlertDescription>
              No code practices were detected for this project yet.
            </AlertDescription>
          </Alert>
        ) : null}
        {!store.loading && !store.error && store.practices.length ? (
          <FieldGroup className="gap-4">
            {store.practices.map((practice) => (
              <PracticeCard
                key={practice.practice}
                practice={practice}
                updating={store.updatingPractice === practice.practice}
                onEnabledChange={(enabled) =>
                  void store.updateEnabled(practice, enabled)
                }
              />
            ))}
          </FieldGroup>
        ) : null}
      </div>
    </div>
  )
}

function PracticeCard({
  onEnabledChange,
  practice,
  updating,
}: {
  onEnabledChange(enabled: boolean): void
  practice: CodePractice
  updating: boolean
}) {
  const switchId = `practice-${practice.practice}`
  const nextEnabled = !practice.enabled

  const togglePractice = () => {
    if (!updating) onEnabledChange(nextEnabled)
  }

  const togglePracticeFromKeyboard = (
    event: React.KeyboardEvent<HTMLDivElement>
  ) => {
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    togglePractice()
  }

  return (
    <Card
      size="sm"
      role="switch"
      tabIndex={0}
      aria-checked={practice.enabled}
      aria-labelledby={`${switchId}-title`}
      className={cn(
        "cursor-pointer rounded-lg transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        practice.enabled
          ? "border-border bg-muted/35"
          : "border-foreground/10 bg-background/95"
      )}
      onClick={togglePractice}
      onKeyDown={togglePracticeFromKeyboard}
    >
      <CardContent className="flex flex-col gap-3">
        <Field orientation="horizontal" className="items-start gap-4">
          <FieldContent>
            <div className="flex flex-wrap items-center gap-2">
              <FieldTitle
                id={`${switchId}-title`}
                className="text-lg font-semibold"
              >
                {practiceLabels[practice.practice]}
              </FieldTitle>
              <Badge
                variant="outline"
                className={cn(
                  practice.detected
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border-red-500/30 bg-red-500/10 text-red-400"
                )}
              >
                {practice.detected ? "Detected" : "Not detected"}
              </Badge>
            </div>
            <FieldDescription>
              {practiceDescriptions[practice.practice]}
            </FieldDescription>
          </FieldContent>
          <Switch
            id={switchId}
            aria-labelledby={`${switchId}-title`}
            checked={practice.enabled}
            disabled={updating}
            size="lg"
            onClick={(event) => event.stopPropagation()}
            onCheckedChange={onEnabledChange}
          />
        </Field>
        <Accordion
          type="single"
          collapsible
          onClick={(event) => event.stopPropagation()}
        >
          <AccordionItem value="comment" className="border-none">
            <AccordionTrigger className="py-1 text-xs text-muted-foreground hover:no-underline">
              Detection comment
            </AccordionTrigger>
            <AccordionContent className="pb-0">
              <Alert className="bg-background/60">
                <AlertDescription>{practice.comment}</AlertDescription>
              </Alert>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  )
}

function PracticesLoading() {
  return (
    <FieldGroup className="gap-4">
      {Array.from({ length: 4 }, (_, index) => (
        <Card key={index} size="sm">
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-5 w-44" />
                <Skeleton className="h-4 w-full max-w-lg" />
              </div>
              <Skeleton className="h-5 w-8 rounded-full" />
            </div>
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      ))}
    </FieldGroup>
  )
}
