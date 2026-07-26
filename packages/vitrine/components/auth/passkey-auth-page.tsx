"use client";

import { ArrowRight, KeyRound } from "lucide-react";
import * as React from "react";

import {
  apiBaseUrl,
  authRequest,
  claimAndApprove,
  isRecord,
  normalizeUserCode,
  readError,
} from "@/components/auth/auth-api";
import {
  AuthPageContent,
  AuthPageShell,
} from "@/components/auth/auth-page-shell";
import { Button, buttonVariants } from "@/components/ui/button";

type PasskeyPhase =
  | "ready"
  | "authenticating"
  | "approving"
  | "approved"
  | "failed";

const passkeyContent: Record<
  PasskeyPhase,
  { description: string; title: string }
> = {
  approved: {
    description:
      "Blame is finishing sign-in automatically. You can close this tab.",
    title: "You’re connected.",
  },
  approving: {
    description: "Your passkey is verified. Blame is being connected.",
    title: "Almost there.",
  },
  authenticating: {
    description: "Follow your browser’s secure passkey prompt.",
    title: "Use your passkey.",
  },
  failed: {
    description: "This passkey could not be verified.",
    title: "Sign-in failed.",
  },
  ready: {
    description: "Use your device biometrics, PIN, or security key.",
    title: "Sign in with a passkey.",
  },
};

type SerializedCredentialDescriptor = Omit<
  PublicKeyCredentialDescriptor,
  "id"
> & { id: string };

type SerializedRequestOptions = Omit<
  PublicKeyCredentialRequestOptions,
  "allowCredentials" | "challenge"
> & {
  allowCredentials?: SerializedCredentialDescriptor[];
  challenge: string;
};

type PasskeyAuthentication = ReturnType<typeof usePasskeyAuthentication>;

export function PasskeyAuthPage() {
  const authentication = usePasskeyAuthentication();
  const content = passkeyContent[authentication.phase];
  return (
    <AuthPageShell celebration={authentication.phase === "approved"}>
      <AuthPageContent
        description={authentication.error ?? content.description}
        loading={
          authentication.phase === "authenticating" ||
          authentication.phase === "approving"
        }
        title={content.title}
        actions={
          authentication.phase === "approved" ||
          authentication.phase === "ready" ||
          authentication.phase === "failed" ? (
            <PasskeyActions authentication={authentication} />
          ) : undefined
        }
      />
    </AuthPageShell>
  );
}

function usePasskeyAuthentication() {
  const [phase, setPhase] = React.useState<PasskeyPhase>("ready");
  const [error, setError] = React.useState<string>();

  async function authenticate() {
    setError(undefined);
    setPhase("authenticating");
    try {
      await authenticateWithPasskey();
      const userCode = requestedUserCode();
      if (!userCode) return completeLegacyPasskeyLogin();
      setPhase("approving");
      await claimAndApprove(userCode);
      setPhase("approved");
    } catch (cause) {
      setError(passkeyError(cause));
      setPhase("failed");
    }
  }

  return { authenticate, error, phase };
}

function PasskeyActions({
  authentication,
}: {
  authentication: PasskeyAuthentication;
}) {
  if (authentication.phase === "approved") {
    return (
      <a href="blame://billing/refresh" className={buttonVariants()}>
        Open Blame
        <ArrowRight className="size-4" />
      </a>
    );
  }
  if (authentication.phase !== "ready" && authentication.phase !== "failed") {
    return null;
  }
  return (
    <Button onClick={() => void authentication.authenticate()}>
      <KeyRound className="size-4" />
      {authentication.phase === "failed"
        ? "Try again"
        : "Continue with passkey"}
    </Button>
  );
}

async function authenticateWithPasskey() {
  ensurePasskeySupport();
  const value = await authRequest(
    "/auth/passkey/generate-authenticate-options",
  );
  const credential = await navigator.credentials.get({
    publicKey: requestOptions(value),
  });
  const response = assertionResponse(credential);
  await authRequest("/auth/passkey/verify-authentication", {
    body: JSON.stringify({ response }),
    method: "POST",
  });
}

function requestOptions(value: unknown): PublicKeyCredentialRequestOptions {
  const body =
    isRecord(value) && isRecord(value.options) ? value.options : value;
  if (!isRecord(body) || typeof body.challenge !== "string") {
    throw new Error("Passkey is unavailable.");
  }
  const serialized = body as unknown as SerializedRequestOptions;
  return {
    ...serialized,
    challenge: decodeBase64Url(serialized.challenge),
    allowCredentials: serialized.allowCredentials?.map((credential) => ({
      ...credential,
      id: decodeBase64Url(credential.id),
    })),
  };
}

function assertionResponse(value: Credential | null) {
  if (
    !(value instanceof PublicKeyCredential) ||
    !(value.response instanceof AuthenticatorAssertionResponse)
  ) {
    throw new Error("This passkey could not be verified.");
  }
  return {
    id: value.id,
    rawId: encodeBase64Url(value.rawId),
    type: value.type,
    response: {
      authenticatorData: encodeBase64Url(value.response.authenticatorData),
      clientDataJSON: encodeBase64Url(value.response.clientDataJSON),
      signature: encodeBase64Url(value.response.signature),
      userHandle: value.response.userHandle
        ? encodeBase64Url(value.response.userHandle)
        : null,
    },
    clientExtensionResults: value.getClientExtensionResults(),
  };
}

function requestedUserCode() {
  const value = new URLSearchParams(window.location.search).get("user_code");
  return value ? normalizeUserCode(value) : undefined;
}

function completeLegacyPasskeyLogin() {
  window.location.assign(`${apiBaseUrl()}/auth/desktop-complete`);
}

function ensurePasskeySupport() {
  if (!window.PublicKeyCredential || !window.AuthenticatorAssertionResponse) {
    throw new Error("Passkeys are not supported in this browser.");
  }
}

function decodeBase64Url(value: string) {
  const base64 = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function encodeBase64Url(value: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(value)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function passkeyError(error: unknown) {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Passkey sign-in was cancelled.";
  }
  return readError(error, "This passkey could not be verified.");
}
