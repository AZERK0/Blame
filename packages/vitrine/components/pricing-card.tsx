'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Boxes, Check } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const billingOptions = {
  monthly: {
    label: 'Monthly',
    price: '€13',
    suffix: '/month',
  },
  yearly: {
    label: 'Yearly',
    price: '€120',
    suffix: '/year',
  },
} as const

type BillingCycle = keyof typeof billingOptions

const primaryFeatures = [
  '1 developer account',
  'Parallel agent worktrees',
  'Live previews for every task',
  'Diff review before merge',
]

const secondaryFeatures = [
  'Cloud-synced backlog',
  'Project coding practices',
  'Local-first execution',
]

export function PricingCard() {
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly')
  const selectedBilling = billingOptions[billingCycle]

  return (
    <Card className="landing-reveal landing-reveal-actions relative mt-12 w-full max-w-[430px] overflow-hidden rounded-[2rem] border-white/18 bg-white/[0.08] p-2 shadow-[0_34px_120px_rgba(0,0,0,0.42)] backdrop-blur-2xl">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(255,255,255,0.18),transparent_28%),radial-gradient(circle_at_80%_18%,rgba(179,172,243,0.2),transparent_36%)]" />
      <CardContent className="relative rounded-[1.55rem] border border-white/14 bg-[#f7f7f8]/90 p-6 text-[#111] shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_18px_60px_rgba(0,0,0,0.24)] backdrop-blur-xl sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="grid h-12 w-12 place-items-center rounded-xl border border-black/5 bg-white shadow-[0_8px_28px_rgba(0,0,0,0.12)]">
            <Boxes className="h-5 w-5" />
          </div>
          <span className="rounded-full bg-[#111] px-3 py-1 text-xs font-semibold text-white">
            Simple plan
          </span>
        </div>

        <div className="mt-7">
          <h2 className="text-2xl font-semibold tracking-[-0.04em] text-[#111]">
            Blame Pro
          </h2>
          <p className="mt-3 text-base leading-6 text-[#111]/70">
            Agent worktrees, previews, and review control.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-2 rounded-full bg-black/[0.06] p-1 text-sm font-semibold">
          {(Object.keys(billingOptions) as BillingCycle[]).map((option) => {
            const isSelected = option === billingCycle

            return (
              <button
                key={option}
                type="button"
                onClick={() => setBillingCycle(option)}
                className={cn(
                  'rounded-full px-4 py-2.5 transition duration-200 focus:outline-none focus:ring-2 focus:ring-[#111]/20',
                  isSelected
                    ? 'bg-white text-[#111] shadow-[0_8px_24px_rgba(0,0,0,0.12)]'
                    : 'text-[#111]/54 hover:text-[#111]',
                )}
                aria-pressed={isSelected}
              >
                {billingOptions[option].label}
              </button>
            )
          })}
        </div>

        <div className="mt-7 flex items-end gap-2">
          <span className="text-6xl font-semibold leading-none tracking-[-0.08em] text-[#111]">
            {selectedBilling.price}
          </span>
          <span className="pb-2 text-lg text-[#111]/54">{selectedBilling.suffix}</span>
        </div>
        {billingCycle === 'yearly' ? (
          <p className="mt-2 text-sm font-medium text-[#111]/54">Save €36 every year.</p>
        ) : null}
        <Link href="/download" className={buttonVariants({ variant: 'dark', className: 'mt-8 w-full' })}>
          Get Blame Pro
        </Link>

        <ul className="mt-8 space-y-4 text-base text-[#111]">
          {primaryFeatures.map((feature) => (
            <li key={feature} className="flex items-center gap-3">
              <Check className="h-4 w-4 shrink-0" />
              {feature}
            </li>
          ))}
        </ul>

        <div className="my-7 h-px bg-black/10" />

        <ul className="space-y-4 text-base text-[#111]">
          {secondaryFeatures.map((feature) => (
            <li key={feature} className="flex items-center gap-3">
              <span className="h-1.5 w-1.5 rounded-full bg-[#111]" />
              {feature}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}