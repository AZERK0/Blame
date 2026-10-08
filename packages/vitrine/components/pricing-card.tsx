"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Check, Info } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const billingOptions = {
  monthly: {
    label: "Monthly",
    price: "$20",
    suffix: "/month",
  },
  yearly: {
    label: "Yearly",
    price: "See checkout",
    suffix: "",
  },
} as const;

type BillingCycle = keyof typeof billingOptions;

const licenseFacts = [
  "Cloud voice transcription",
  "Managed cloud previews",
  "Hosted file uploads",
  "Existing usage limits apply",
  "Cancel anytime",
];

export function PricingCard() {
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const [isTooltipHovered, setIsTooltipHovered] = useState(false);
  const [isTooltipFocused, setIsTooltipFocused] = useState(false);
  const [isTooltipPinned, setIsTooltipPinned] = useState(false);
  const selectedBilling = billingOptions[billingCycle];
  const isTooltipOpen = isTooltipHovered || isTooltipFocused || isTooltipPinned;

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
          <span
            className={cn(
              "font-semibold leading-none tracking-[-0.08em] text-[#111]",
              billingCycle === "monthly" ? "text-6xl" : "text-3xl",
            )}
          >
            {selectedBilling.price}
          </span>
          <span className="pb-2 text-lg text-[#111]/54">
            {selectedBilling.suffix}
          </span>
        </div>
        {billingCycle === "yearly" ? (
          <p className="mt-2 text-sm font-medium text-[#111]/54">
            The annual price is confirmed in checkout.
          </p>
        ) : null}
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
          {licenseFacts.map((fact) => (
            <li key={fact} className="relative flex items-center gap-3">
              <Check className="h-4 w-4 shrink-0" />
              <span>{fact}</span>
              {fact === "Bring your own AI access" ? (
                <span
                  className="flex"
                  onMouseEnter={() => setIsTooltipHovered(true)}
                  onMouseLeave={() => setIsTooltipHovered(false)}
                >
                  <button
                    type="button"
                    className="grid h-6 w-6 place-items-center rounded-full text-[#111]/50 transition hover:bg-black/[0.06] hover:text-[#111] focus:outline-none focus:ring-2 focus:ring-[#111]/20"
                    aria-label="More information about AI usage"
                    aria-describedby="ai-usage-tooltip"
                    aria-expanded={isTooltipOpen}
                    onClick={() => setIsTooltipPinned((isPinned) => !isPinned)}
                    onFocus={() => setIsTooltipFocused(true)}
                    onBlur={() => {
                      setIsTooltipFocused(false);
                      setIsTooltipPinned(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setIsTooltipFocused(false);
                        setIsTooltipPinned(false);
                      }
                    }}
                  >
                    <Info className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <span
                    id="ai-usage-tooltip"
                    role="tooltip"
                    className={cn(
                      "absolute bottom-full left-0 z-20 mb-2 w-full max-w-72 rounded-xl bg-[#111] p-4 text-left text-white shadow-[0_14px_40px_rgba(0,0,0,0.28)] transition duration-150",
                      isTooltipOpen
                        ? "visible translate-y-0 opacity-100"
                        : "invisible translate-y-1 opacity-0",
                    )}
                  >
                    <span className="block text-sm font-semibold">
                      AI usage is not included
                    </span>
                    <span className="mt-1.5 block text-xs leading-5 text-white/70">
                      Blame provides the software layer used to run and control
                      coding agents. Connect your own supported AI provider
                      using an API key or compatible OAuth-based subscription
                      authentication. Provider usage, limits, and charges remain
                      subject to that provider.
                    </span>
                  </span>
                </span>
              ) : null}
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
