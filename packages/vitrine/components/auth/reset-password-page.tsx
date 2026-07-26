"use client";

import { ArrowRight } from "lucide-react";
import * as React from "react";

import { authRequest, readError } from "@/components/auth/auth-api";
import {
  AuthPageContent,
  AuthPageShell,
} from "@/components/auth/auth-page-shell";
import { Button, buttonVariants } from "@/components/ui/button";

type ResetPhase = "checking" | "ready" | "submitting" | "success" | "failed";

type ResetPasswordFormProps = {
  disabled: boolean;
  onSubmit(password: string): void;
};

type PasswordFieldProps = {
  id: string;
  label: string;
  onChange(value: string): void;
  value: string;
};

const resetContent: Record<ResetPhase, { description: string; title: string }> =
  {
    checking: {
      description: "Preparing your secure password reset.",
      title: "Checking your link.",
    },
    failed: {
      description: "This reset link is invalid or expired.",
      title: "Link unavailable.",
    },
    ready: {
      description: "Use a unique passphrase between 12 and 128 characters.",
      title: "Choose a new password.",
    },
    submitting: {
      description: "Your new password is being secured.",
      title: "Updating password.",
    },
    success: {
      description: "Your password is updated. You can now sign in to Blame.",
      title: "Password updated.",
    },
  };

function usePasswordReset() {
  const [phase, setPhase] = React.useState<ResetPhase>("checking");
  const [error, setError] = React.useState<string>();
  const token = React.useRef("");

  React.useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    token.current = parameters.get("token") ?? "";
    window.history.replaceState({}, "", window.location.pathname);
    if (parameters.has("error") || !token.current) {
      setError("This reset link is invalid or expired.");
      setPhase("failed");
      return;
    }
    setPhase("ready");
  }, []);

  function submit(password: string) {
    void resetPassword(token.current, password, setPhase, setError);
  }

  return { error, phase, submit };
}

export function ResetPasswordPage() {
  const reset = usePasswordReset();
  const content = resetContent[reset.phase];
  return (
    <AuthPageShell celebration={reset.phase === "success"}>
      <AuthPageContent
        description={reset.error ?? content.description}
        loading={reset.phase === "checking" || reset.phase === "submitting"}
        title={content.title}
        form={
          reset.phase === "ready" || reset.phase === "submitting" ? (
            <ResetPasswordForm
              disabled={reset.phase === "submitting"}
              onSubmit={reset.submit}
            />
          ) : undefined
        }
        actions={
          reset.phase === "success" ? <ResetPasswordAction /> : undefined
        }
      />
    </AuthPageShell>
  );
}

function ResetPasswordAction() {
  return (
    <a href="blame://billing/refresh" className={buttonVariants()}>
      Return to Blame
      <ArrowRight className="size-4" />
    </a>
  );
}

function ResetPasswordForm({ disabled, onSubmit }: ResetPasswordFormProps) {
  const form = usePasswordConfirmation(onSubmit);
  return (
    <form
      className="landing-reveal mx-auto mt-9 grid w-full max-w-md gap-5 text-left"
      onSubmit={form.submit}
    >
      <PasswordField
        id="new-password"
        label="New password"
        value={form.password}
        onChange={form.setPassword}
      />
      <PasswordField
        id="password-confirmation"
        label="Confirm password"
        value={form.confirmation}
        onChange={form.setConfirmation}
      />
      {form.error ? (
        <p className="text-sm text-red-300" role="alert">
          {form.error}
        </p>
      ) : null}
      <Button disabled={disabled} type="submit">
        Update password
      </Button>
    </form>
  );
}

function usePasswordConfirmation(onSubmit: (password: string) => void) {
  const [password, setPassword] = React.useState("");
  const [confirmation, setConfirmation] = React.useState("");
  const [error, setError] = React.useState<string>();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }
    setError(undefined);
    onSubmit(password);
  }

  return {
    confirmation,
    error,
    password,
    setConfirmation,
    setPassword,
    submit,
  };
}

function PasswordField({ id, label, onChange, value }: PasswordFieldProps) {
  return (
    <label
      className="grid gap-2 text-sm font-semibold text-white/84"
      htmlFor={id}
    >
      {label}
      <input
        autoComplete="new-password"
        className="min-h-12 rounded-2xl border border-white/14 bg-white/[0.07] px-4 text-base text-white outline-none backdrop-blur-md transition focus:border-[#b3acf3] focus:ring-2 focus:ring-[#b3acf3]/40"
        id={id}
        maxLength={128}
        minLength={12}
        required
        type="password"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

async function resetPassword(
  token: string,
  password: string,
  setPhase: React.Dispatch<React.SetStateAction<ResetPhase>>,
  setError: React.Dispatch<React.SetStateAction<string | undefined>>,
) {
  setPhase("submitting");
  setError(undefined);
  try {
    await authRequest("/auth/reset-password", {
      body: JSON.stringify({ token, newPassword: password }),
      method: "POST",
    });
    setPhase("success");
  } catch (cause) {
    setError(readError(cause, "This reset link is invalid or expired."));
    setPhase("ready");
  }
}
