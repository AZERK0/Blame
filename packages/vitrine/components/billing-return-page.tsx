"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  CircleX,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";

import { LandingRevealStyles } from "@/components/landing-reveal-styles";
import { SiteHeader } from "@/components/site-header";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type BillingReturnVariant = "success" | "cancelled" | "portal";

const content = {
  success: {
    eyebrow: "Checkout complete",
    title: "Verify your license in Blame.",
    description:
      "Checkout has returned you to Blame. Open the app to securely check the subscription attached to your account and update workspace access.",
    action: "Open Blame and verify",
    Icon: CheckCircle2,
    accent: "bg-emerald-300/12 text-emerald-200 ring-emerald-200/20",
  },
  cancelled: {
    eyebrow: "Checkout closed",
    title: "No payment was made.",
    description:
      "Your checkout was cancelled and no license change was applied. You can return to Blame whenever you are ready.",
    action: "Return to Blame",
    Icon: CircleX,
    accent: "bg-white/[0.07] text-white/72 ring-white/15",
  },
  portal: {
    eyebrow: "Portal closed",
    title: "Check your billing status in Blame.",
    description:
      "Open Blame to securely check your license after reviewing subscription, payment method, or cancellation settings.",
    action: "Open Blame and refresh",
    Icon: ShieldCheck,
    accent: "bg-[#b3acf3]/14 text-[#dedaff] ring-[#b3acf3]/24",
  },
} as const;

export function BillingReturnPage({
  variant,
}: {
  variant: BillingReturnVariant;
}) {
  const page = content[variant];
  const [launchAttempted, setLaunchAttempted] = useState(false);

  useEffect(() => {
    if (variant === "cancelled") return;
    const timer = window.setTimeout(() => {
      setLaunchAttempted(true);
      window.location.assign("blame://billing/refresh");
    }, 700);
    return () => window.clearTimeout(timer);
  }, [variant]);

  return (
    <main className="min-h-screen overflow-hidden bg-[#050712] text-white">
      <SiteHeader />
      <section className="relative isolate flex min-h-screen items-center px-5 pb-16 pt-28 sm:px-8 lg:px-10">
        <div className="pointer-events-none absolute inset-0 -z-20 bg-[radial-gradient(circle_at_50%_18%,rgba(179,172,243,0.18),transparent_32%),radial-gradient(circle_at_16%_84%,rgba(91,180,255,0.11),transparent_30%),linear-gradient(180deg,#070a17_0%,#050712_70%)]" />
        <div className="pointer-events-none absolute inset-0 -z-10 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] [background-size:52px_52px] [mask-image:radial-gradient(circle_at_center,black,transparent_78%)]" />

        <div className="mx-auto w-full max-w-3xl">
          <div className="landing-reveal landing-reveal-actions relative overflow-hidden rounded-[2.25rem] border border-white/14 bg-white/[0.065] p-2 shadow-[0_36px_140px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(255,255,255,0.17),transparent_28%),radial-gradient(circle_at_80%_14%,rgba(179,172,243,0.17),transparent_34%)]" />
            <div className="relative rounded-[1.75rem] border border-white/10 bg-[#090c18]/88 px-6 py-10 text-center sm:px-12 sm:py-14">
              <div
                className={cn(
                  "mx-auto grid size-16 place-items-center rounded-2xl ring-1",
                  page.accent,
                )}
              >
                <page.Icon className="size-7" aria-hidden="true" />
              </div>
              <p className="landing-reveal landing-reveal-eyebrow mt-7 text-xs font-semibold uppercase tracking-[0.34em] text-[#b3acf3]">
                {page.eyebrow}
              </p>
              <h1 className="landing-reveal landing-reveal-title mx-auto mt-4 max-w-2xl text-balance text-[clamp(2.6rem,7vw,5.2rem)] font-semibold leading-[0.92] tracking-[-0.06em]">
                {page.title}
              </h1>
              <p className="landing-reveal landing-reveal-copy mx-auto mt-6 max-w-xl text-balance text-base leading-7 text-white/62 sm:text-lg">
                {page.description}
              </p>

              <div className="landing-reveal landing-reveal-actions mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <a href="blame://billing/refresh" className={buttonVariants()}>
                  {page.action}
                  <ArrowRight className="size-4" />
                </a>
                <Link
                  href="/download"
                  className={buttonVariants({ variant: "outline" })}
                >
                  Download Blame
                  <ExternalLink className="size-4" />
                </Link>
              </div>

              {launchAttempted ? (
                <p className="mt-6 text-sm text-white/42">
                  If Blame did not open, use the button above. Your license is
                  always verified inside the app.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </section>
      <LandingRevealStyles />
    </main>
  );
}
