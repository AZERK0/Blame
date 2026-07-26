"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import * as React from "react";

import {
  authRequest,
  claimAndApprove,
  hasAuthenticatedUser,
  isRecord,
  normalizeUserCode,
  readError,
  responseData,
} from "@/components/auth/auth-api";
import {
  AuthPageContent,
  AuthPageShell,
} from "@/components/auth/auth-page-shell";
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
        setError(
          readError(cause, "The sign-in request could not be completed."),
        );
        setPhase("failed");
      });
  }, []);

  return (
    <AuthPageShell celebration={phase === "approved"}>
      <AuthorizationContent error={error} phase={phase} retryUrl={retryUrl} />
    </AuthPageShell>
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
  const loading =
    phase === "checking" || phase === "redirecting" || phase === "approving";

  return (
    <AuthPageContent
      description={error ?? content.description}
      loading={loading}
      title={content.title}
      actions={
        phase === "approved" ? (
          <a href="blame://billing/refresh" className={buttonVariants()}>
            Open Blame
            <ArrowRight className="size-4" />
          </a>
        ) : phase === "failed" ? (
          <>
            <a href={retryUrl} className={buttonVariants()}>
              Try again
            </a>
            <Link
              href="/download"
              className={buttonVariants({ variant: "outline" })}
            >
              Download Blame
            </Link>
          </>
        ) : undefined
      }
    />
  );
}

function authorizationContent(phase: AuthorizationPhase) {
  if (phase === "approved") {
    return {
      description:
        "Blame is finishing sign-in automatically. You can close this tab.",
      title: "You’re connected.",
    };
  }
  if (phase === "failed") {
    return {
      description: "The sign-in request could not be completed.",
      title: "Connection failed.",
    };
  }
  if (phase === "redirecting") {
    return {
      description: "You’re being redirected to your identity provider.",
      title: "Continue securely.",
    };
  }
  if (phase === "approving") {
    return {
      description: "The browser session is verified. Blame is being connected.",
      title: "Almost there.",
    };
  }
  return {
    description: "Checking the secure connection request.",
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

async function startSocialSignIn(userCode: string, provider: AuthProvider) {
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

function desktopAuthUrl(userCode: string, provider: AuthProvider) {
  const url = new URL("/auth/desktop", window.location.origin);
  url.searchParams.set("user_code", userCode);
  url.searchParams.set("provider", provider);
  return url.toString();
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
