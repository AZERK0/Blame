import * as React from "react"
import { LoaderCircleIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useCloudAuth } from "@/context/cloud-auth"
import { publicAssetUrl } from "@/lib/public-asset-url"
import { SettingsDialog, SettingsDialogButton } from "@/pages/settings/page"

type AuthMode = "login" | "signup"
type AuthFieldProps = {
  description?: string
  id: string
  label: string
  onChange(value: string): void
  required?: boolean
  type?: React.HTMLInputTypeAttribute
  value: string
}

export function ConnectScreen() {
  const [mode, setMode] = React.useState<AuthMode>("login")
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const introReady = useIntroReady()

  return (
    <>
      <main className="light relative h-svh overflow-hidden bg-background/10 text-foreground backdrop-blur-md">
        <SettingsDialogButton
          className="absolute top-4 right-4 z-10"
          onClick={() => setSettingsOpen(true)}
        />
        <section className="flex h-full flex-col gap-4 bg-background/50 p-6 md:p-8">
          <AppLogo />
          <div className="flex flex-1 items-center justify-center">
            <div
              key={mode}
              className={`w-full max-w-xs transform-gpu transition-all delay-150 duration-700 ease-out motion-reduce:transform-none motion-reduce:transition-none ${
                introReady
                  ? "blur-0 translate-y-0 scale-100 opacity-100"
                  : "translate-y-5 scale-[0.98] opacity-0 blur-md"
              }`}
            >
              {mode === "login" ? (
                <LoginForm onModeChange={setMode} />
              ) : (
                <SignupForm onModeChange={setMode} />
              )}
            </div>
          </div>
        </section>
      </main>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  )
}

function AppLogo() {
  return (
    <div className="flex items-center gap-3" aria-label="Blame">
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
      onSubmit={form.submit(() => auth.login({ email, password }))}
    >
      <FieldGroup>
        <FormTitle title="Login to your account" description="" />
        <LoginFields
          email={email}
          password={password}
          setEmail={setEmail}
          setPassword={setPassword}
        />
        <AuthError error={form.error} />
        <SubmitButton loading={form.loading}>Login</SubmitButton>
        <SocialAuthButton
          action="Sign in with GitHub"
          onClick={() => form.fail("GitHub authentication is not available.")}
        />
        <ModePrompt action="Sign up" onClick={() => onModeChange("signup")}>
          Don&apos;t have an account?
        </ModePrompt>
      </FieldGroup>
    </form>
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
      onSubmit={form.submit(() =>
        auth.signup({
          email,
          fullName: fullName.trim() || null,
          password,
          passwordConfirmation,
        })
      )}
    >
      <FieldGroup>
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
        <AuthError error={form.error} />
        <SubmitButton loading={form.loading}>Create account</SubmitButton>
        <SocialAuthButton
          action="Sign up with GitHub"
          onClick={() => form.fail("GitHub authentication is not available.")}
        />
        <ModePrompt action="Sign in" onClick={() => onModeChange("login")}>
          Already have an account?
        </ModePrompt>
      </FieldGroup>
    </form>
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
      description="We'll use this to contact you about your workspace."
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
      description="Must be at least 8 characters long."
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
}: AuthFieldProps) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        className="bg-background"
        id={id}
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

function AuthError({ error }: { error: string | undefined }) {
  if (!error) return null
  return <FieldError>{error}</FieldError>
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

function SocialAuthButton({
  action,
  onClick,
}: {
  action: string
  onClick(): void
}) {
  return (
    <>
      <AuthSeparator>Or continue with</AuthSeparator>
      <Field>
        <Button variant="outline" type="button" onClick={onClick}>
          <GitHubIcon />
          {action}
        </Button>
      </Field>
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

function useAuthForm() {
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string>()

  return {
    error,
    fail: setError,
    loading,
    submit:
      (handler: () => Promise<void>) =>
      (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        setError(undefined)
        setLoading(true)
        void handler()
          .catch((error) =>
            setError(error instanceof Error ? error.message : "Request failed")
          )
          .finally(() => setLoading(false))
      },
  }
}
