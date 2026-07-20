import * as React from "react"
import { ArrowRightIcon, CheckIcon, LoaderCircleIcon } from "lucide-react"

import blameDarkAppIconUrl from "../../../../vitrine/public/icons/blame-dark-app-icon.png?url"
import { CompactWindowChrome } from "@/components/layout/compact-window-chrome"
import { LegalLink } from "@/components/legal/legal-link"
import { Button } from "@/components/ui/button"
import { useCloudAuth } from "@/context/cloud-auth"

const billingOptions = {
  monthly: { label: "Monthly", price: "€13", suffix: "/month" },
  yearly: { label: "Yearly", price: "€120", suffix: "/year" },
} as const

const licenseFacts = [
  "1 developer license",
  "Windows, macOS & Linux",
  "Product updates included",
  "Use your own AI provider",
  "Cancel anytime",
] as const

type BillingCycle = keyof typeof billingOptions
type PendingAction = BillingCycle | "refresh"

export function LicenseScreen() {
  const actions = useLicenseActions()
  const [billingCycle, setBillingCycle] =
    React.useState<BillingCycle>("monthly")

  return (
    <main className="light relative min-h-svh overflow-y-auto bg-[#ededf0] text-[#111]">
      <CompactWindowChrome />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(255,255,255,0.95),transparent_42%),radial-gradient(circle_at_15%_85%,rgba(179,172,243,0.18),transparent_34%)]" />
      <section className="relative mx-auto flex min-h-svh w-full max-w-xl flex-col items-center justify-center px-6 pt-10 pb-16 sm:pt-14 sm:pb-16">
        <div className="flex w-full [zoom:.8] flex-col items-center">
          <PricingCard
            billingCycle={billingCycle}
            loading={actions.pending === billingCycle}
            disabled={actions.pending !== null}
            onBillingCycleChange={setBillingCycle}
            onCheckout={actions.checkout}
          />
          <LicenseError error={actions.error} />
          <LicenseActions actions={actions} />
        </div>
      </section>
    </main>
  )
}

function PricingCard({
  billingCycle,
  disabled,
  loading,
  onBillingCycleChange,
  onCheckout,
}: PricingCardProps) {
  return (
    <article className="relative w-full max-w-[430px] overflow-hidden rounded-[2rem] border border-white/70 bg-white/30 p-2 shadow-[0_34px_100px_rgba(29,29,35,0.18)] backdrop-blur-2xl">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(255,255,255,0.85),transparent_32%),radial-gradient(circle_at_80%_18%,rgba(179,172,243,0.24),transparent_38%)]" />
      <div className="relative rounded-[1.55rem] border border-white/80 bg-[#f7f7f8]/95 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_18px_60px_rgba(29,29,35,0.12)] sm:p-7">
        <PricingCardHeader />
        <BillingSelector
          value={billingCycle}
          disabled={disabled}
          onChange={onBillingCycleChange}
        />
        <PriceSummary billingCycle={billingCycle} />
        <CheckoutButton
          billingCycle={billingCycle}
          loading={loading}
          disabled={disabled}
          onCheckout={onCheckout}
        />
        <LicenseFactList />
      </div>
    </article>
  )
}

function PricingCardHeader() {
  return (
    <header>
      <img
        src={blameDarkAppIconUrl}
        alt=""
        width={48}
        height={48}
        className="size-12 object-contain"
      />
      <h2 className="mt-7 font-heading text-2xl font-semibold tracking-[-0.04em]">
        Blame License
      </h2>
      <p className="mt-3 text-base leading-6 text-[#111]/70">
        Full access to the Blame desktop app.
      </p>
    </header>
  )
}

function BillingSelector({
  disabled,
  value,
  onChange,
}: {
  disabled: boolean
  value: BillingCycle
  onChange(cycle: BillingCycle): void
}) {
  return (
    <fieldset className="mt-6 grid grid-cols-2 rounded-full bg-black/[0.06] p-1 text-sm font-semibold">
      <legend className="sr-only">Billing cycle</legend>
      {(Object.keys(billingOptions) as BillingCycle[]).map((cycle) => (
        <button
          key={cycle}
          type="button"
          className={billingOptionClassName(cycle === value)}
          aria-pressed={cycle === value}
          disabled={disabled}
          onClick={() => onChange(cycle)}
        >
          {billingOptions[cycle].label}
        </button>
      ))}
    </fieldset>
  )
}

function PriceSummary({ billingCycle }: { billingCycle: BillingCycle }) {
  const selectedBilling = billingOptions[billingCycle]

  return (
    <div>
      <div className="mt-7 flex items-end gap-2">
        <span className="text-6xl leading-none font-semibold tracking-[-0.08em]">
          {selectedBilling.price}
        </span>
        <span className="pb-2 text-lg text-[#111]/54">
          {selectedBilling.suffix}
        </span>
      </div>
      <p
        className={`mt-2 min-h-5 text-sm font-medium text-[#111]/54 ${billingCycle === "yearly" ? "visible" : "invisible"}`}
      >
        Save €36 every year.
      </p>
    </div>
  )
}

function CheckoutButton({
  billingCycle,
  disabled,
  loading,
  onCheckout,
}: CheckoutButtonProps) {
  return (
    <div className="mt-6">
      <Button
        className="h-11 w-full rounded-full bg-[#111] text-base text-white shadow-[0_10px_28px_rgba(0,0,0,0.2)] hover:bg-[#292929]"
        disabled={disabled}
        onClick={() => onCheckout(billingCycle)}
      >
        {loading ? <LoaderCircleIcon className="animate-spin" /> : null}
        {loading ? "Opening checkout" : "Get Blame"}
      </Button>
      <PurchaseLegalLinks />
      <p className="mt-3 text-center text-xs leading-5 text-[#111]/54">
        AI usage is not included and may be billed separately by your provider.
      </p>
    </div>
  )
}

function PurchaseLegalLinks() {
  return (
    <nav
      aria-label="Purchase policies"
      className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs leading-5 text-[#111]/54"
    >
      <LegalLink page="terms" className="hover:text-[#111]">
        Terms
      </LegalLink>
      <LegalLink page="privacy" className="hover:text-[#111]">
        Privacy
      </LegalLink>
      <LegalLink page="refund" className="hover:text-[#111]">
        Refunds
      </LegalLink>
      <LegalLink page="withdrawal" className="hover:text-[#111]">
        Withdrawal
      </LegalLink>
    </nav>
  )
}

function LicenseFactList() {
  return (
    <ul className="mt-7 space-y-4 text-base">
      {licenseFacts.map((fact) => (
        <li key={fact} className="flex items-center gap-3">
          <CheckIcon className="size-4 shrink-0" aria-hidden="true" />
          <span>{fact}</span>
        </li>
      ))}
    </ul>
  )
}

function LicenseActions({ actions }: { actions: LicenseActionState }) {
  return (
    <div className="mt-8 flex justify-center">
      <Button
        variant="link"
        className="h-11 w-fit rounded-full px-5 text-base"
        disabled={actions.pending !== null}
        onClick={actions.refresh}
      >
        I completed payment
        {actions.pending === "refresh" ? (
          <LoaderCircleIcon className="animate-spin" />
        ) : (
          <ArrowRightIcon />
        )}
      </Button>
    </div>
  )
}

function LicenseError({ error }: { error: string | null }) {
  if (!error) return null

  return (
    <p
      role="alert"
      className="mt-4 w-full max-w-[430px] rounded-xl bg-destructive/10 px-4 py-3 text-center text-sm text-destructive"
    >
      {error}
    </p>
  )
}

function useLicenseActions(): LicenseActionState {
  const auth = useCloudAuth()
  const [pending, setPending] = React.useState<PendingAction | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function run(name: PendingAction, action: () => Promise<void>) {
    setPending(name)
    setError(null)
    try {
      await action()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(null)
    }
  }

  return {
    error,
    pending,
    checkout: (cycle) => void run(cycle, () => auth.startCheckout(cycle)),
    refresh: () => void run("refresh", auth.refreshLicense),
  }
}

function billingOptionClassName(selected: boolean) {
  const shared =
    "rounded-full px-4 py-2.5 transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111]/20 disabled:cursor-not-allowed"
  const state = selected
    ? "bg-white text-[#111] shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
    : "text-[#111]/54 hover:text-[#111]"

  return `${shared} ${state}`
}

function errorMessage(cause: unknown) {
  return cause instanceof Error
    ? cause.message
    : "Unable to complete the request. Please try again."
}

type PricingCardProps = {
  billingCycle: BillingCycle
  disabled: boolean
  loading: boolean
  onBillingCycleChange(cycle: BillingCycle): void
  onCheckout(cycle: BillingCycle): void
}

type CheckoutButtonProps = Pick<
  PricingCardProps,
  "billingCycle" | "disabled" | "loading" | "onCheckout"
>

type LicenseActionState = {
  error: string | null
  pending: PendingAction | null
  checkout(cycle: BillingCycle): void
  refresh(): void
}
