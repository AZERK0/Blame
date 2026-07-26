"use client";

import { ArrowRight } from "lucide-react";
import * as React from "react";

import {
  authRequest,
  claimAndApprove,
  hasAuthenticatedUser,
  normalizeUserCode,
  readError,
} from "@/components/auth/auth-api";
import {
  AuthPageContent,
  AuthPageShell,
} from "@/components/auth/auth-page-shell";
import { buttonVariants } from "@/components/ui/button";

type VerificationPhase =
  | "checking"
  | "approving"
  | "approved"
  | "verified"
  | "failed";

const verificationContent: Record<
  VerificationPhase,
  { description: string; title: string }
> = {
  approved: {
    description:
      "Blame is signing you in automatically. You can close this tab.",
    title: "You’re connected.",
  },
  approving: {
    description: "Your address is verified. Blame is being connected.",
    title: "Almost there.",
  },
  checking: {
    description: "Confirming your email and securing the desktop connection.",
    title: "Verifying your email.",
  },
  failed: {
    description: "This verification link is invalid or expired.",
    title: "Verification failed.",
  },
  verified: {
    description: "Your address is verified. You can return to Blame.",
    title: "Email verified.",
  },
};

function useEmailVerification() {
  const [phase, setPhase] = React.useState<VerificationPhase>("checking");
  const [error, setError] = React.useState<string>();
  const started = React.useRef(false);

  React.useEffect(() => {
    if (started.current) return;
    started.current = true;
    void finishEmailVerification(setPhase).catch((cause) => {
      setError(
        readError(cause, "This verification link is invalid or expired."),
      );
      setPhase("failed");
    });
  }, []);

  return { error, phase };
}

export function VerifyEmailPage() {
  const verification = useEmailVerification();
  const content = verificationContent[verification.phase];
  return (
    <AuthPageShell
      celebration={
        verification.phase === "approved" || verification.phase === "verified"
      }
    >
      <AuthPageContent
        description={verification.error ?? content.description}
        loading={
          verification.phase === "checking" ||
          verification.phase === "approving"
        }
        title={content.title}
        actions={
          verification.phase === "approved" ||
          verification.phase === "verified" ? (
            <VerificationAction />
          ) : undefined
        }
      />
    </AuthPageShell>
  );
}

function VerificationAction() {
  return (
    <a href="blame://billing/refresh" className={buttonVariants()}>
      Open Blame
      <ArrowRight className="size-4" />
    </a>
  );
}

async function finishEmailVerification(
  setPhase: React.Dispatch<React.SetStateAction<VerificationPhase>>,
) {
  const parameters = new URLSearchParams(window.location.search);
  const error = parameters.get("error");
  if (error) throw new Error(verificationError(error));
  const value = parameters.get("user_code");
  if (!value) {
    if (parameters.get("verified") !== "true") {
      throw new Error("This verification link is invalid or expired.");
    }
    setPhase("verified");
    return;
  }
  const userCode = normalizeUserCode(value);
  const session = await authRequest("/auth/get-session");
  if (!hasAuthenticatedUser(session)) {
    throw new Error("The verified browser session could not be established.");
  }
  setPhase("approving");
  try {
    await claimAndApprove(userCode);
    setPhase("approved");
  } catch {
    setPhase("verified");
  }
}

function verificationError(error: string) {
  if (error === "TOKEN_EXPIRED") return "This verification link has expired.";
  if (error === "INVALID_TOKEN") return "This verification link is invalid.";
  return "Your email address could not be verified.";
}
