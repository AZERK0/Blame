"use client";

import Link from "next/link";
import {
  CircleAlert,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import * as React from "react";

import { HeroScene } from "@/app/scene/hero-scene";
import { LandingRevealStyles } from "@/components/landing-reveal-styles";
import { SceneWarmup } from "@/components/scene-warmup";
import { SiteHeader } from "@/components/site-header";
import { buttonVariants } from "@/components/ui/button";

type AuthProvider = "github" | "google" | "microsoft";
type AuthorizationPhase =
  | "checking"
  | "redirecting"
  | "approving"
  | "approved"
  | "failed";

export function DesktopAuthPage() {
  const [phase, setPhase] = React.useState<AuthorizationPhase>("checking");
  const [error, setError] = React.useState<string>();
  const [retryUrl, setRetryUrl] = React.useState("/download");
  const started = React.useRef(false);

  React.useEffect(() => {
    if (started.current) return;
    started.current = true;
    void authorizeDesktop(setPhase, setRetryUrl)
      .then((result) => {
        setRetryUrl(result.retryUrl);
        setPhase(result.phase);
      })
      .catch((cause) => {
        setError(readError(cause));
        setPhase("failed");
      });
  }, []);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#050712] text-white">
      <section
        aria-labelledby="desktop-auth-title"
        className="hero-stage relative isolate min-h-screen overflow-hidden px-5 pb-24 pt-24 sm:px-8 lg:px-10"
      >
        <HeroScene terrainPreset="download" celebration={phase === "approved"} />
        <SceneWarmup />
        <div className="pointer-events-none absolute -inset-8 -z-10 backdrop-blur-[12px] [mask-image:radial-gradient(ellipse_at_center,transparent_0%,transparent_48%,black_78%)]" />
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(2,4,10,0.1)_0%,rgba(2,4,10,0.26)_42%,rgba(2,4,10,0.58)_74%,rgba(2,4,10,0.9)_100%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-56 bg-gradient-to-b from-[#050712]/64 to-transparent" />
        <div className="pointer-events-none absolute bottom-0 left-1/2 -z-10 h-[34rem] w-[48rem] -translate-x-1/2 rounded-full bg-[#9fd7ff]/10 blur-3xl" />

        <SiteHeader />

        <div className="relative z-10 mx-auto flex min-h-[calc(100vh-6rem)] w-full max-w-5xl items-center justify-center py-12 text-center">
          <AuthorizationContent
            error={error}
            phase={phase}
            retryUrl={retryUrl}
          />
        </div>

        <LandingRevealStyles />
      </section>
    </main>
  );
}

function AuthorizationContent({
  error,
  phase,
  retryUrl,
}: {
  error?: string;
  phase: AuthorizationPhase;
  retryUrl: string;
}) {
  const content = authorizationContent(phase);
  const Icon = content.icon;

  return (
    <div className="w-full">
      <div className="landing-reveal mx-auto mb-7 grid size-16 place-items-center rounded-2xl border border-white/14 bg-white/[0.08] shadow-2xl shadow-black/30 backdrop-blur-xl">
        <Icon
          className={`size-7 ${phase === "checking" || phase === "redirecting" || phase === "approving" ? "animate-spin" : ""}`}
        />
      </div>
      <h1
        id="desktop-auth-title"
        className="landing-reveal landing-reveal-title mx-auto max-w-4xl text-balance text-[clamp(3rem,8vw,7rem)] font-semibold leading-[0.9] tracking-tighter text-white drop-shadow-[0_20px_70px_rgba(0,0,0,0.55)] sm:leading-32"
      >
        {content.title}
      </h1>
      <p className="landing-reveal landing-reveal-copy mx-auto mt-7 max-w-2xl text-balance text-base leading-7 text-white/76 sm:text-lg md:text-xl">
        {error ?? content.description}
      </p>
      {phase === "failed" ? (
        <div className="landing-reveal landing-reveal-actions mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a href={retryUrl} className={buttonVariants()}>
            Try again
          </a>
          <Link
            href="/download"
            className={buttonVariants({ variant: "outline" })}
          >
            Download Blame
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function authorizationContent(phase: AuthorizationPhase) {
  if (phase === "approved") {
    return {
      description:
        "Blame is finishing sign-in automatically. You can close this tab.",
      icon: ShieldCheck,
      title: "You’re connected.",
    };
  }
  if (phase === "failed") {
    return {
      description: "The sign-in request could not be completed.",
      icon: CircleAlert,
      title: "Connection failed.",
    };
  }
  if (phase === "redirecting") {
    return {
      description: "You’re being redirected to your identity provider.",
      icon: LoaderCircle,
      title: "Continue securely.",
    };
  }
  if (phase === "approving") {
    return {
      description: "The browser session is verified. Blame is being connected.",
      icon: LoaderCircle,
      title: "Almost there.",
    };
  }
  return {
    description: "Checking the secure connection request.",
    icon: LoaderCircle,
    title: "Connect Blame.",
  };
}

async function authorizeDesktop(
  setPhase: React.Dispatch<React.SetStateAction<AuthorizationPhase>>,
  setRetryUrl: React.Dispatch<React.SetStateAction<string>>,
) {
  const parameters = new URLSearchParams(window.location.search);
  const userCode = normalizeUserCode(parameters.get("user_code"));
  const provider = readProvider(parameters.get("provider"));
  const retryUrl = desktopAuthUrl(userCode, provider);
  setRetryUrl(retryUrl);

  if (parameters.has("error") || parameters.get("oauth") === "error") {
    throw new Error("The identity provider did not complete sign-in.");
  }

  if (parameters.get("oauth") !== "return") {
    setPhase("redirecting");
    await startSocialSignIn(userCode, provider);
    return { phase: "redirecting" as const, retryUrl };
  }

  const session = await authRequest("/auth/get-session");
  if (!hasAuthenticatedUser(session)) {
    throw new Error("The browser session could not be established.");
  }
  setPhase("approving");
  await claimAndApprove(userCode);
  return { phase: "approved" as const, retryUrl };
}

async function startSocialSignIn(
  userCode: string,
  provider: AuthProvider,
) {
  const callbackUrl = new URL(desktopAuthUrl(userCode, provider));
  callbackUrl.searchParams.set("oauth", "return");
  const errorCallbackUrl = new URL(desktopAuthUrl(userCode, provider));
  errorCallbackUrl.searchParams.set("oauth", "error");
  const response = await authRequest("/auth/sign-in/social", {
    body: JSON.stringify({
      provider,
      callbackURL: callbackUrl.toString(),
      errorCallbackURL: errorCallbackUrl.toString(),
      disableRedirect: true,
    }),
    method: "POST",
  });
  const redirectUrl = readRedirectUrl(response);
  window.location.assign(redirectUrl);
}

async function claimAndApprove(userCode: string) {
  await authRequest(`/auth/device?user_code=${encodeURIComponent(userCode)}`);
  await authRequest("/auth/device/approve", {
    body: JSON.stringify({ userCode }),
    method: "POST",
  });
}

async function authRequest(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (init?.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseError(body));
  return responseData(body);
}

function apiBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_BLAME_API_URL ?? "https://api.blame.so/api/v1"
  ).replace(/\/$/, "");
}

function desktopAuthUrl(userCode: string, provider: AuthProvider) {
  const url = new URL("/auth/desktop", window.location.origin);
  url.searchParams.set("user_code", userCode);
  url.searchParams.set("provider", provider);
  return url.toString();
}

function normalizeUserCode(value: string | null) {
  const userCode = value?.replaceAll("-", "").trim().toUpperCase() ?? "";
  if (!/^[A-Z2-9]{8}$/.test(userCode)) {
    throw new Error("This connection request is invalid or has expired.");
  }
  return userCode;
}

function readProvider(value: string | null): AuthProvider {
  if (value === "github" || value === "google" || value === "microsoft") {
    return value;
  }
  throw new Error("This sign-in provider is not supported.");
}

function readRedirectUrl(value: unknown) {
  const body = responseData(value);
  if (!isRecord(body) || typeof body.url !== "string") {
    throw new Error("This sign-in provider is not available.");
  }
  return body.url;
}

function hasAuthenticatedUser(value: unknown) {
  const body = responseData(value);
  return isRecord(body) && isRecord(body.user);
}

function responseData(value: unknown): unknown {
  if (!isRecord(value) || !("data" in value)) return value;
  return value.data;
}

function responseError(value: unknown) {
  if (!isRecord(value)) return "The authentication service is unavailable.";
  if (typeof value.error_description === "string") {
    return value.error_description;
  }
  if (typeof value.message === "string") return value.message;
  return "The authentication service is unavailable.";
}

function readError(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The sign-in request could not be completed.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
