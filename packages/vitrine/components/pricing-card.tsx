"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Check } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const billingOptions = {
  monthly: {
    label: "Monthly",
    price: "20",
    suffix: "USD /month",
  },
  yearly: {
    label: "Yearly",
    price: "200",
    suffix: "USD /year",
  },
} as const;

type BillingCycle = keyof typeof billingOptions;

const premiumBenefits = [
  "Managed cloud previews",
  "Cloud voice transcription",
  "Hosted file uploads",
  "Existing usage limits apply",
  "Cancel anytime",
] as const;

export function PricingCard() {
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const selectedBilling = billingOptions[billingCycle];

  return (
    <Card className="landing-reveal landing-reveal-actions relative mt-12 w-full max-w-[430px] overflow-hidden rounded-[2rem] border-white/18 bg-white/[0.08] p-2 shadow-[0_34px_120px_rgba(0,0,0,0.42)] backdrop-blur-2xl">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(255,255,255,0.18),transparent_28%),radial-gradient(circle_at_80%_18%,rgba(179,172,243,0.2),transparent_36%)]" />
      <CardContent className="relative rounded-[1.55rem] border border-white/14 bg-[#f7f7f8]/90 p-6 text-[#111] shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_18px_60px_rgba(0,0,0,0.24)] backdrop-blur-xl sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <Image
            src="/icons/blame-dark-app-icon.png"
            alt=""
            width={48}
            height={48}
            className="h-12 w-12 object-contain"
          />
        </div>

        <div className="mt-7">
          <h2 className="text-2xl font-semibold tracking-[-0.04em] text-[#111]">
            Blame Premium
          </h2>
          <p className="mt-3 text-base leading-6 text-[#111]/70">
            Cloud services hosted and funded by Blame. Local development and
            your own AI providers remain free.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-2 rounded-full bg-black/[0.06] p-1 text-sm font-semibold">
          {(Object.keys(billingOptions) as BillingCycle[]).map((option) => {
            const isSelected = option === billingCycle;

            return (
              <button
                key={option}
                type="button"
                onClick={() => setBillingCycle(option)}
                className={cn(
                  "rounded-full px-4 py-2.5 transition duration-200 focus:outline-none focus:ring-2 focus:ring-[#111]/20",
                  isSelected
                    ? "bg-white text-[#111] shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
                    : "text-[#111]/54 hover:text-[#111]",
                )}
                aria-pressed={isSelected}
              >
                {billingOptions[option].label}
              </button>
            );
          })}
        </div>

        <div className="mt-7 flex items-end gap-2">
          <span className="text-6xl font-semibold leading-none tracking-[-0.04em] text-[#111]">
            {selectedBilling.price}
          </span>
          <span className="pb-2 text-lg text-[#111]/54">
            {selectedBilling.suffix}
          </span>
        </div>
        <p
          className={`mt-2 min-h-5 text-sm font-medium text-[#111]/54 ${billingCycle === "yearly" ? "visible" : "invisible"}`}
        >
          Billed once a year.
        </p>
        <Link
          href="/download"
          className={buttonVariants({
            variant: "dark",
            className: "mt-8 w-full",
          })}
        >
          Download Blame
        </Link>
        <PricingLegalLinks />
        <p className="mt-3 text-center text-xs leading-5 text-[#111]/54">
          AI usage is not included and may be billed separately by your
          provider.
        </p>

        <ul className="mt-7 space-y-4 text-base text-[#111]">
          {premiumBenefits.map((benefit) => (
            <li key={benefit} className="flex items-center gap-3">
              <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{benefit}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function PricingLegalLinks() {
  return (
    <nav
      aria-label="Purchase policies"
      className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs leading-5 text-[#111]/54"
    >
      <Link
        className="underline underline-offset-2 hover:text-[#111]"
        href="/terms-of-service"
      >
        Terms
      </Link>
      <Link
        className="underline underline-offset-2 hover:text-[#111]"
        href="/privacy"
      >
        Privacy
      </Link>
      <Link
        className="underline underline-offset-2 hover:text-[#111]"
        href="/refund-policy"
      >
        Refunds
      </Link>
      <Link
        className="underline underline-offset-2 hover:text-[#111]"
        href="/withdraw"
      >
        Withdrawal
      </Link>
    </nav>
  );
}
