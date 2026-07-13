import { ArrowLeftIcon, LogOutIcon } from "lucide-react"

import { navigate } from "@/components/navigation/navigation"
import { Button } from "@/components/ui/button"
import { useCloudAuth } from "@/context/cloud-auth"
import { AccountPrivacyPanel } from "@/pages/settings/account-privacy-panel"

export function AccountPrivacyPage() {
  const auth = useCloudAuth()

  return (
    <main className="light min-h-svh bg-background p-6 text-foreground">
      <section className="mx-auto w-full max-w-3xl rounded-2xl border bg-card p-6 shadow-sm md:p-8">
        <AccountPrivacyHeader email={auth.user?.email} />
        <div className="py-4">
          <AccountPrivacyPanel />
        </div>
        <AccountPrivacyFooter onLogout={auth.logout} />
      </section>
    </main>
  )
}

function AccountPrivacyHeader({ email }: { email?: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
      <div>
        <p className="text-sm font-semibold text-primary">BLAME ACCOUNT</p>
        <h1 className="mt-2 font-heading text-3xl font-semibold">
          Privacy and account data
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage the cloud data associated with {email}.
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={() => navigate("/backlog")}
      >
        <ArrowLeftIcon /> Back
      </Button>
    </div>
  )
}

function AccountPrivacyFooter({ onLogout }: { onLogout(): Promise<void> }) {
  return (
    <div className="flex justify-end border-t pt-6">
      <Button type="button" variant="ghost" onClick={() => void onLogout()}>
        <LogOutIcon /> Sign out
      </Button>
    </div>
  )
}
