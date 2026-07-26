import * as React from "react"
import { KeyRoundIcon, LoaderCircleIcon } from "lucide-react"
import { toast } from "sonner"

import { CompactWindowChrome } from "@/components/layout/compact-window-chrome"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Toaster } from "@/components/ui/sonner"
import { LegalLink } from "@/components/legal/legal-link"
import { useCloudAuth } from "@/context/cloud-auth"
import { publicAssetUrl } from "@/lib/public-asset-url"

type AuthMode = "login" | "signup" | "forgot" | "verify" | "two-factor"
type AuthFieldProps = {
  description?: string
  id: string
  label: string
  onChange(value: string): void
  required?: boolean
  type?: React.HTMLInputTypeAttribute
  value: string
  minLength?: number
  maxLength?: number
}

export function ConnectScreen() {
  const [mode, setMode] = React.useState<AuthMode>("login")
  const introReady = useIntroReady()

  return (
    <main className="light relative h-svh overflow-hidden bg-background/10 text-foreground backdrop-blur-md">
      <CompactWindowChrome />
      <Toaster />
      <section className="flex h-full flex-col gap-4 bg-background/50 p-6 pb-16 md:p-8 md:pb-16">
        <AppLogo />
        <div className="flex flex-1 items-center justify-center">
          <div
            key={mode}
            className={`w-full max-w-xs transform-gpu [zoom:.86] transition-all delay-150 duration-700 ease-out motion-reduce:transform-none motion-reduce:transition-none ${
              introReady
                ? "blur-0 translate-y-0 scale-100 opacity-100"
                : "translate-y-5 scale-[0.98] opacity-0 blur-md"
            }`}
          >
            {mode === "login" ? (
              <LoginForm onModeChange={setMode} />
            ) : mode === "signup" ? (
              <SignupForm onModeChange={setMode} />
            ) : mode === "forgot" ? (
              <ForgotPasswordForm onModeChange={setMode} />
            ) : mode === "verify" ? (
              <VerificationForm onModeChange={setMode} />
            ) : (
              <EmailTwoFactorForm onModeChange={setMode} />
            )}
          </div>
        </div>
      </section>
    </main>
  )
}

function AppLogo() {
  return (
    <div className="flex [zoom:.86] items-center gap-3" aria-label="Blame">
      <span className="grid h-10 w-10 place-items-center">
        <img
          alt=""
          className="h-10 w-10 object-contain"
          src={publicAssetUrl("web-app-manifest-512x512.png")}
        />
      </span>
      <span className="text-2xl font-extrabold">Blame</span>
    </div>
  )
}

function useIntroReady() {
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  return ready
}

function LoginForm({ onModeChange }: { onModeChange(mode: AuthMode): void }) {
  const auth = useCloudAuth()
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const form = useAuthForm()

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={form.submit(async () => {
        const result = await auth.login({ email, password })
        if (result === "two-factor") onModeChange("two-factor")
        if (result === "email-verification") onModeChange("verify")
      })}
    >
      <FieldGroup className="gap-4">
        <FormTitle title="Login to your account" description="" />
        <LoginFields
          email={email}
          password={password}
          setEmail={setEmail}
          setPassword={setPassword}
        />
        <AuthErrorToast error={form.error ?? auth.error} />
        <SubmitButton loading={form.loading}>Login</SubmitButton>
        <button
          className="text-sm font-medium text-foreground/70 underline-offset-4 hover:text-foreground hover:underline"
          type="button"
          onClick={() => onModeChange("forgot")}
        >
          Forgot your password?
        </button>
        <AlternativeAuth
          loading={form.loading}
          onPasskey={() => form.run(() => auth.passkeyLogin())}
          onSocial={(provider) => form.run(() => auth.socialLogin(provider))}
        />
        <AuthLegalNotice mode="login" />
        <ModePrompt action="Sign up" onClick={() => onModeChange("signup")}>
          Don&apos;t have an account?
        </ModePrompt>
      </FieldGroup>
    </form>
  )
}

function EmailTwoFactorForm({ onModeChange }: { onModeChange(mode: AuthMode): void }) {
  const auth = useCloudAuth()
  const [code, setCode] = React.useState("")
  const [sent, setSent] = React.useState(false)
  const form = useAuthForm()
  const resend = async () => {
    await auth.resendEmailTwoFactor()
    setSent(true)
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={form.submit(() => auth.verifyEmailTwoFactor(code.trim()))}
    >
      <FieldGroup className="gap-4">
        <EmailTwoFactorFields code={code} sent={sent} setCode={setCode} />
        <AuthErrorToast error={form.error} />
        <SubmitButton loading={form.loading}>Verify code</SubmitButton>
        <EmailTwoFactorActions
          loading={form.loading}
          onBack={() => onModeChange("login")}
          onResend={() => form.run(resend)}
        />
      </FieldGroup>
    </form>
  )
}

function EmailTwoFactorFields({
  code,
  sent,
  setCode,
}: {
  code: string
  sent: boolean
  setCode(value: string): void
}) {
  return (
    <>
      <FormTitle
        title="Check your email"
        description="Enter the 6-digit sign-in code we sent you."
      />
      <AuthField
        id="email-two-factor-code"
        label="Sign-in code"
        value={code}
        onChange={setCode}
        minLength={6}
        maxLength={6}
      />
      {sent ? <FieldDescription>A new code was sent.</FieldDescription> : null}
    </>
  )
}

function EmailTwoFactorActions({
  loading,
  onBack,
  onResend,
}: {
  loading: boolean
  onBack(): void
  onResend(): void
}) {
  return (
    <>
      <Button disabled={loading} type="button" variant="link" onClick={onResend}>
        Send a new code
      </Button>
      <ModePrompt action="Back to login" onClick={onBack}>
        Use another account?
      </ModePrompt>
    </>
  )
}

function SignupForm({ onModeChange }: { onModeChange(mode: AuthMode): void }) {
  const auth = useCloudAuth()
  const [fullName, setFullName] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [passwordConfirmation, setPasswordConfirmation] = React.useState("")
  const form = useAuthForm()

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={form.submit(async () => {
        if (password !== passwordConfirmation) throw new Error("Passwords do not match.")
        await auth.signup({
          email,
          fullName: fullName.trim() || null,
          password,
          passwordConfirmation,
        })
        onModeChange("verify")
      })}
    >
      <FieldGroup className="gap-4">
        <FormTitle title="Create your account" description="" />
        <SignupFields
          email={email}
          fullName={fullName}
          password={password}
          passwordConfirmation={passwordConfirmation}
          setEmail={setEmail}
          setFullName={setFullName}
          setPassword={setPassword}
          setPasswordConfirmation={setPasswordConfirmation}
        />
        <AuthErrorToast error={form.error} />
        <AuthLegalNotice mode="signup" />
        <SubmitButton loading={form.loading}>Create account</SubmitButton>
        <AlternativeAuth
          loading={form.loading}
          onPasskey={() => form.fail("Create an account first, then add a passkey securely.")}
          onSocial={(provider) => form.run(() => auth.socialLogin(provider))}
        />
        <ModePrompt action="Sign in" onClick={() => onModeChange("login")}>
          Already have an account?
        </ModePrompt>
      </FieldGroup>
    </form>
  )
}

function ForgotPasswordForm({ onModeChange }: { onModeChange(mode: AuthMode): void }) {
  const auth = useCloudAuth()
  const [email, setEmail] = React.useState("")
  const [sent, setSent] = React.useState(false)
  const form = useAuthForm()
  return (
    <form className="flex flex-col gap-6" onSubmit={form.submit(async () => {
      await auth.requestPasswordReset(email)
      setSent(true)
    })}>
      <FieldGroup className="gap-4">
        <FormTitle title="Reset your password" description="We’ll email a secure link if an account exists for this address." />
        {sent ? (
          <FieldDescription className="rounded-md border border-emerald-600/20 bg-emerald-500/10 p-3 text-emerald-800">
            Check your inbox. The reset link expires in 30 minutes.
          </FieldDescription>
        ) : <AuthField id="reset-email" label="Email" type="email" value={email} onChange={setEmail} />}
        <AuthErrorToast error={form.error} />
        {!sent ? <SubmitButton loading={form.loading}>Send reset link</SubmitButton> : null}
        <ModePrompt action="Back to login" onClick={() => onModeChange("login")}>Remembered your password?</ModePrompt>
      </FieldGroup>
    </form>
  )
}

function VerificationForm({ onModeChange }: { onModeChange(mode: AuthMode): void }) {
  const auth = useCloudAuth()
  const [email, setEmail] = React.useState("")
  const [sent, setSent] = React.useState(false)
  const form = useAuthForm()
  return (
    <form className="flex flex-col gap-6" onSubmit={form.submit(async () => {
      await auth.resendVerification(email)
      setSent(true)
    })}>
      <FieldGroup className="gap-4">
        <FormTitle title="Verify your email" description="Open the verification link we sent before signing in with a password." />
        <AuthField id="verify-email" label="Email" type="email" value={email} onChange={setEmail} />
        {sent ? <FieldDescription>A fresh verification link was sent.</FieldDescription> : null}
        <AuthErrorToast error={form.error ?? auth.error} />
        <SubmitButton loading={form.loading}>Resend verification email</SubmitButton>
        <ModePrompt action="Back to login" onClick={() => onModeChange("login")}>Already verified?</ModePrompt>
      </FieldGroup>
    </form>
  )
}

function AuthLegalNotice({ mode }: { mode: AuthMode }) {
  return (
    <FieldDescription className="px-2 text-center text-xs leading-5 text-foreground/60">
      {mode === "signup"
        ? "By creating an account, you agree to the "
        : "Blame is provided under our "}
      <LegalLink page="terms">Terms of Service</LegalLink>
      {mode === "signup"
        ? " and acknowledge the "
        : ". Learn how we handle personal data in our "}
      <LegalLink page="privacy">Privacy Policy</LegalLink>.
    </FieldDescription>
  )
}

function LoginFields({
  email,
  password,
  setEmail,
  setPassword,
}: {
  email: string
  password: string
  setEmail(value: string): void
  setPassword(value: string): void
}) {
  return (
    <>
      <AuthField
        id="login-email"
        label="Email"
        type="email"
        value={email}
        onChange={setEmail}
      />
      <AuthField
        id="login-password"
        label="Password"
        type="password"
        value={password}
        onChange={setPassword}
      />
    </>
  )
}

function SignupFields({
  email,
  fullName,
  password,
  passwordConfirmation,
  setEmail,
  setFullName,
  setPassword,
  setPasswordConfirmation,
}: {
  email: string
  fullName: string
  password: string
  passwordConfirmation: string
  setEmail(value: string): void
  setFullName(value: string): void
  setPassword(value: string): void
  setPasswordConfirmation(value: string): void
}) {
  return (
    <>
      <FullNameField value={fullName} onChange={setFullName} />
      <SignupEmailField value={email} onChange={setEmail} />
      <SignupPasswordField value={password} onChange={setPassword} />
      <PasswordConfirmationField
        value={passwordConfirmation}
        onChange={setPasswordConfirmation}
      />
    </>
  )
}

function FullNameField({
  onChange,
  value,
}: {
  onChange(value: string): void
  value: string
}) {
  return (
    <AuthField
      id="signup-name"
      label="Full Name"
      value={value}
      onChange={onChange}
    />
  )
}

function SignupEmailField({
  onChange,
  value,
}: {
  onChange(value: string): void
  value: string
}) {
  return (
    <AuthField
      id="signup-email"
      label="Email"
      type="email"
      value={value}
      onChange={onChange}
    />
  )
}

function SignupPasswordField({
  onChange,
  value,
}: {
  onChange(value: string): void
  value: string
}) {
  return (
    <AuthField
      id="signup-password"
      label="Password"
      type="password"
      value={value}
      onChange={onChange}
      description="12–128 characters. Use a unique passphrase; password managers are recommended."
      minLength={12}
      maxLength={128}
    />
  )
}

function PasswordConfirmationField({
  onChange,
  value,
}: {
  onChange(value: string): void
  value: string
}) {
  return (
    <AuthField
      id="signup-password-confirmation"
      label="Confirm password"
      type="password"
      value={value}
      onChange={onChange}
    />
  )
}

function FormTitle({
  description,
  title,
}: {
  description: string
  title: string
}) {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <h2 className="text-3xl font-bold">{title}</h2>
      <p className="text-sm text-balance text-foreground/70">{description}</p>
    </div>
  )
}

function AuthField({
  description,
  id,
  label,
  onChange,
  required = true,
  type = "text",
  value,
  minLength,
  maxLength,
}: AuthFieldProps) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        className="bg-background"
        id={id}
        minLength={minLength}
        maxLength={maxLength}
        required={required}
        type={type}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {description ? (
        <FieldDescription className="text-foreground/70">
          {description}
        </FieldDescription>
      ) : null}
    </Field>
  )
}

function AuthErrorToast({ error }: { error: string | undefined }) {
  React.useEffect(() => {
    if (error) toast.error(error, { position: "bottom-right" })
  }, [error])

  return null
}

function SubmitButton({
  children,
  loading,
}: {
  children: React.ReactNode
  loading: boolean
}) {
  return (
    <Field>
      <Button type="submit" disabled={loading}>
        {loading ? <LoaderCircleIcon className="animate-spin" /> : null}
        {children}
      </Button>
    </Field>
  )
}

function AlternativeAuth({ loading, onPasskey, onSocial }: {
  loading: boolean
  onPasskey(): void
  onSocial(provider: "github" | "google" | "microsoft"): void
}) {
  return (
    <>
      <AuthSeparator>Or continue with</AuthSeparator>
      <Field className="grid grid-cols-3 gap-2">
        <Button aria-label="Continue with GitHub" disabled={loading} variant="outline" type="button" onClick={() => onSocial("github")}>
          <GitHubIcon />
        </Button>
        <Button aria-label="Continue with Google" disabled={loading} variant="outline" type="button" onClick={() => onSocial("google")}>
          <GoogleIcon />
        </Button>
        <Button aria-label="Continue with Microsoft" disabled={loading} variant="outline" type="button" onClick={() => onSocial("microsoft")}>
          <MicrosoftIcon />
        </Button>
      </Field>
      <Button disabled={loading} variant="outline" type="button" onClick={onPasskey}>
        <KeyRoundIcon /> Sign in with a passkey
      </Button>
    </>
  )
}

function AuthSeparator({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-sm text-foreground/70">
      <span className="h-px flex-1 bg-foreground/20" />
      <span className="shrink-0">{children}</span>
      <span className="h-px flex-1 bg-foreground/20" />
    </div>
  )
}

function ModePrompt({
  action,
  children,
  onClick,
}: {
  action: string
  children: React.ReactNode
  onClick(): void
}) {
  return (
    <Field>
      <FieldDescription className="px-6 text-center text-foreground/70">
        {children}{" "}
        <Button
          className="h-auto p-0"
          variant="link"
          type="button"
          onClick={onClick}
        >
          {action}
        </Button>
      </FieldDescription>
    </Field>
  )
}

function GitHubIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <path
        d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
        fill="currentColor"
      />
    </svg>
  )
}

function GoogleIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18">
      <path
        d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.797 2.716v2.258h2.909c1.702-1.566 2.684-3.874 2.684-6.615"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.468-.806 5.956-2.18l-2.909-2.258c-.806.54-1.835.859-3.047.859-2.344 0-4.328-1.585-5.037-3.715H.956v2.332A9 9 0 0 0 9 18"
        fill="#34A853"
      />
      <path
        d="M3.963 10.706A5.4 5.4 0 0 1 3.682 9c0-.592.102-1.168.281-1.706V4.962H.956A9 9 0 0 0 0 9c0 1.45.347 2.824.956 4.038z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.579c1.321 0 2.507.454 3.44 1.346l2.582-2.582C13.463.892 11.43 0 9 0A9 9 0 0 0 .956 4.962l3.007 2.332C4.672 5.164 6.656 3.579 9 3.579"
        fill="#EA4335"
      />
    </svg>
  )
}

function MicrosoftIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21">
      <path d="M1 1h9v9H1z" fill="#F25022" />
      <path d="M11 1h9v9h-9z" fill="#7FBA00" />
      <path d="M1 11h9v9H1z" fill="#00A4EF" />
      <path d="M11 11h9v9h-9z" fill="#FFB900" />
    </svg>
  )
}

function useAuthForm() {
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string>()

  return {
    error,
    fail: setError,
    loading,
    run(handler: () => Promise<void>) {
      setError(undefined)
      setLoading(true)
      void handler()
        .catch((error) =>
          setError(error instanceof Error ? friendlyAuthError(error.message) : "Request failed")
        )
        .finally(() => setLoading(false))
    },
    submit:
      (handler: () => Promise<void>) =>
      (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        setError(undefined)
        setLoading(true)
        void handler()
          .catch((error) =>
            setError(error instanceof Error ? friendlyAuthError(error.message) : "Request failed")
          )
          .finally(() => setLoading(false))
      },
  }
}

function friendlyAuthError(message: string) {
  const normalized = message.toLowerCase()
  if (normalized.includes("email not verified")) return "Verify your email before signing in. You can request a new link below."
  if (normalized.includes("invalid email or password") || normalized.includes("invalid password")) return "The email or password is incorrect."
  if (normalized.includes("too many")) return "Too many attempts. Wait a minute, then try again."
  if (normalized.includes("account not linked")) return "This email already has an account. Sign in first, then link this provider from settings."
  return message
}
