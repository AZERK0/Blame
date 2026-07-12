import * as React from "react"
import { CheckIcon, LoaderCircleIcon, LogOutIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useCloudAuth } from "@/context/cloud-auth"

export function LicenseScreen() {
  const auth = useCloudAuth()
  const [pending, setPending] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function run(name: string, action: () => Promise<void>) {
    setPending(name)
    setError(null)
    try {
      await action()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to open secure billing."
      )
    } finally {
      setPending(null)
    }
  }

  return (
    <main className="light flex min-h-svh items-center justify-center bg-background p-6 text-foreground">
      <section className="w-full max-w-3xl rounded-3xl border bg-card p-8 shadow-xl md:p-12">
        <p className="text-sm font-semibold text-primary">BLAME LICENSE</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight">
          Activate your workspace
        </h1>
        <p className="mt-4 max-w-xl text-muted-foreground">
          An active license is required to use Blame. Payment is handled
          securely by Stripe.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <Plan
            title="Monthly"
            price="€13"
            suffix="/month"
            onClick={() => run("monthly", () => auth.startCheckout("monthly"))}
            loading={pending === "monthly"}
            disabled={pending !== null}
          />
          <Plan
            title="Yearly"
            price="€120"
            suffix="/year"
            note="Save €36 per year"
            onClick={() => run("yearly", () => auth.startCheckout("yearly"))}
            loading={pending === "yearly"}
            disabled={pending !== null}
          />
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            onClick={() => run("refresh", auth.refreshLicense)}
            disabled={pending !== null}
          >
            {pending === "refresh" && (
              <LoaderCircleIcon className="animate-spin" />
            )}{" "}
            I completed payment
          </Button>
          <Button variant="ghost" onClick={() => void auth.logout()}>
            <LogOutIcon /> Sign out
          </Button>
        </div>
        {error ? (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  )
}

function Plan({
  title,
  price,
  suffix,
  note,
  loading,
  disabled,
  onClick,
}: {
  title: string
  price: string
  suffix: string
  note?: string
  loading: boolean
  disabled: boolean
  onClick(): void
}) {
  return (
    <article className="rounded-2xl border p-6">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-3">
        <span className="text-4xl font-bold">{price}</span>
        <span className="text-muted-foreground">{suffix}</span>
      </div>
      <p className="mt-2 h-5 text-sm text-muted-foreground">{note}</p>
      <p className="mt-5 flex items-center gap-2 text-sm">
        <CheckIcon className="size-4" /> Full Blame access
      </p>
      <Button className="mt-6 w-full" onClick={onClick} disabled={disabled}>
        {loading && <LoaderCircleIcon className="animate-spin" />} Choose{" "}
        {title.toLowerCase()}
      </Button>
    </article>
  )
}
