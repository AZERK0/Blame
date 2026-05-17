import * as React from "react"
import { LoaderCircleIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { useCloudAuth } from "@/context/cloud-auth"

export function ConnectScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <section className="grid w-full max-w-sm gap-6">
        <div className="grid gap-2 text-center">
          <h1 className="font-heading text-3xl font-semibold">Blame</h1>
          <p className="text-sm text-muted-foreground">
            Connect your cloud account to continue.
          </p>
        </div>
        <Tabs defaultValue="login" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">Login</TabsTrigger>
            <TabsTrigger value="signup">Create account</TabsTrigger>
          </TabsList>
          <TabsContent value="login">
            <LoginForm />
          </TabsContent>
          <TabsContent value="signup">
            <SignupForm />
          </TabsContent>
        </Tabs>
      </section>
    </main>
  )
}

function LoginForm() {
  const auth = useCloudAuth()
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const form = useAuthForm()

  return (
    <form
      className="grid gap-4 rounded-lg border bg-card p-4 text-card-foreground"
      onSubmit={form.submit(() => auth.login({ email, password }))}
    >
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
      <AuthError error={form.error} />
      <Button type="submit" disabled={form.loading}>
        {form.loading ? <LoaderCircleIcon className="animate-spin" /> : null}
        Login
      </Button>
    </form>
  )
}

function SignupForm() {
  const auth = useCloudAuth()
  const [fullName, setFullName] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [passwordConfirmation, setPasswordConfirmation] = React.useState("")
  const form = useAuthForm()

  return (
    <form
      className="grid gap-4 rounded-lg border bg-card p-4 text-card-foreground"
      onSubmit={form.submit(() =>
        auth.signup({
          email,
          fullName: fullName.trim() || null,
          password,
          passwordConfirmation,
        })
      )}
    >
      <AuthField
        id="signup-name"
        label="Full name"
        value={fullName}
        onChange={setFullName}
      />
      <AuthField
        id="signup-email"
        label="Email"
        type="email"
        value={email}
        onChange={setEmail}
      />
      <AuthField
        id="signup-password"
        label="Password"
        type="password"
        value={password}
        onChange={setPassword}
      />
      <AuthField
        id="signup-password-confirmation"
        label="Confirm password"
        type="password"
        value={passwordConfirmation}
        onChange={setPasswordConfirmation}
      />
      <AuthError error={form.error} />
      <Button type="submit" disabled={form.loading}>
        {form.loading ? <LoaderCircleIcon className="animate-spin" /> : null}
        Create account
      </Button>
    </form>
  )
}

function AuthField({
  id,
  label,
  onChange,
  type = "text",
  value,
}: {
  id: string
  label: string
  onChange(value: string): void
  type?: React.HTMLInputTypeAttribute
  value: string
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        required={type !== "text" || label !== "Full name"}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  )
}

function AuthError({ error }: { error: string | undefined }) {
  if (!error) return null
  return <p className="text-sm text-destructive">{error}</p>
}

function useAuthForm() {
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string>()

  return {
    error,
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
