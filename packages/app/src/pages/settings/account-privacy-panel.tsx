import * as React from "react"
import { DownloadIcon, LoaderCircleIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useCloudAuth } from "@/context/cloud-auth"
import {
  downloadAccountClosureReceipt,
  saveAccountClosureReceipt,
} from "@/lib/account-closure-receipt-storage"
import {
  createCloudApi,
  type CloudAccountExport,
  type CloudAccountClosureReceipt,
} from "@/lib/cloud-api"

type PrivacyAction = "export" | "closure" | undefined

export function AccountPrivacyPanel() {
  const auth = useCloudAuth()
  const [action, setAction] = React.useState<PrivacyAction>()

  return (
    <section>
      <PrivacyPanelHeader />
      <PrivacyActions onAction={setAction} />
      {action === "export" ? (
        <ExportDialog open onOpenChange={dialogChange(setAction, "export")} />
      ) : null}
      {action === "closure" ? (
        <ClosureDialog
          email={auth.user?.email ?? ""}
          open
          onOpenChange={dialogChange(setAction, "closure")}
        />
      ) : null}
    </section>
  )
}

function PrivacyPanelHeader() {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-semibold">Data and account closure</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Export your cloud data or permanently close your Blame account.
      </p>
    </div>
  )
}

function PrivacyActions({
  onAction,
}: {
  onAction(action: PrivacyAction): void
}) {
  return (
    <div>
      <ExportPrivacyAction onClick={() => onAction("export")} />
      <ClosurePrivacyAction onClick={() => onAction("closure")} />
    </div>
  )
}

function ExportPrivacyAction({ onClick }: { onClick(): void }) {
  return (
    <PrivacyRow
      title="Export account data"
      description="Download structured JSON. Stored authentication fields are excluded; free-form content may still contain secrets you supplied."
    >
      <Button type="button" variant="outline" onClick={onClick}>
        <DownloadIcon /> Export
      </Button>
    </PrivacyRow>
  )
}

function ClosurePrivacyAction({ onClick }: { onClick(): void }) {
  return (
    <PrivacyRow
      title="Close account"
      description="Disable access and delete active cloud data. Local files and logs remain on your device."
    >
      <Button type="button" variant="destructive" onClick={onClick}>
        <Trash2Icon /> Close account
      </Button>
    </PrivacyRow>
  )
}

function ExportDialog({ open, onOpenChange }: PrivacyDialogProps) {
  const auth = useCloudAuth()
  const form = useVerifiedAction()

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    await form.run(() =>
      exportAccount(auth.apiConnection, form.password, onOpenChange)
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form className="grid gap-4" onSubmit={submit}>
          <ExportDialogHeader />
          <PasswordField {...form} />
          <PrivacyDialogFooter
            pending={form.pending}
            action="Download export"
          />
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ExportDialogHeader() {
  return (
    <DialogHeader>
      <DialogTitle>Export account data</DialogTitle>
      <DialogDescription>
        Enter your current password. The export contains cloud account and
        workspace data. Dedicated authentication fields are excluded, but
        free-form content may reproduce secrets you supplied.
      </DialogDescription>
    </DialogHeader>
  )
}

function ClosureDialog({
  email,
  open,
  onOpenChange,
}: PrivacyDialogProps & { email: string }) {
  const closure = useClosureForm(email)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form className="grid gap-4" onSubmit={closure.submit}>
          <ClosureDialogHeader />
          <ClosureFields email={email} {...closure} />
          <PrivacyDialogFooter
            pending={closure.form.pending}
            disabled={!closure.confirmed}
            action="Permanently close account"
            destructive
          />
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ClosureFields({
  confirmation,
  email,
  form,
  setConfirmation,
}: ReturnType<typeof useClosureForm> & { email: string }) {
  return (
    <FieldGroup className="gap-4">
      <PasswordField {...form} />
      <Field>
        <FieldLabel htmlFor="closure-email">Type {email} to confirm</FieldLabel>
        <Input
          id="closure-email"
          autoComplete="off"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </Field>
    </FieldGroup>
  )
}

function ClosureDialogHeader() {
  return (
    <DialogHeader>
      <DialogTitle>Permanently close account</DialogTitle>
      <DialogDescription>
        Access ends immediately. Active cloud data is normally deleted at once
        and no later than 30 days; residual backups rotate out within 90 days
        after active deletion. A protected receipt remains available after
        sign-out. Restricted billing, security, or legal records may remain
        where required. Local repositories, worktrees, settings, and logs are
        not deleted. This action is irreversible and does not itself create a
        refund.
      </DialogDescription>
    </DialogHeader>
  )
}

function PasswordField(form: ReturnType<typeof useVerifiedAction>) {
  return (
    <FieldGroup className="gap-4">
      <Field>
        <FieldLabel htmlFor="account-current-password">
          Current password
        </FieldLabel>
        <Input
          id="account-current-password"
          type="password"
          autoComplete="current-password"
          value={form.password}
          onChange={(event) => form.setPassword(event.target.value)}
        />
      </Field>
      <FieldError>{form.error}</FieldError>
    </FieldGroup>
  )
}

function PrivacyDialogFooter({
  action,
  destructive,
  disabled,
  pending,
}: {
  action: string
  destructive?: boolean
  disabled?: boolean
  pending: boolean
}) {
  return (
    <DialogFooter>
      <DialogClose asChild>
        <Button type="button" variant="outline" disabled={pending}>
          Cancel
        </Button>
      </DialogClose>
      <Button
        type="submit"
        variant={destructive ? "destructive" : "default"}
        disabled={disabled || pending}
      >
        {pending ? <LoaderCircleIcon className="animate-spin" /> : null}
        {action}
      </Button>
    </DialogFooter>
  )
}

function PrivacyRow({
  children,
  description,
  title,
}: {
  children: React.ReactNode
  description: string
  title: string
}) {
  return (
    <div className="flex flex-col gap-3 border-b py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex min-w-0 shrink-0 items-center gap-2 sm:justify-end">
        {children}
      </div>
    </div>
  )
}

function useVerifiedAction() {
  const [password, setPassword] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState("")

  async function run(action: () => Promise<void>) {
    setPending(true)
    setError("")
    try {
      await action()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to complete this request."
      )
    } finally {
      setPending(false)
    }
  }

  return { error, password, pending, run, setPassword }
}

function useClosureForm(email: string) {
  const auth = useCloudAuth()
  const form = useVerifiedAction()
  const [confirmation, setConfirmation] = React.useState("")

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    await form.run(async () => {
      const receipt = await createCloudApi(auth.apiConnection).closeAccount({
        password: form.password,
        confirmation,
      })
      saveAccountClosureReceipt(receipt)
      downloadAccountClosureReceipt(receipt)
      showClosureReceipt(receipt)
      await auth.logout()
    })
  }

  const confirmed = confirmation.trim().toLowerCase() === email.toLowerCase()
  return { confirmation, confirmed, form, setConfirmation, submit }
}

function downloadAccountExport(accountExport: CloudAccountExport) {
  const content = JSON.stringify(accountExport, null, 2)
  const objectUrl = URL.createObjectURL(
    new Blob([content], { type: "application/json" })
  )
  const link = document.createElement("a")
  link.href = objectUrl
  link.download = `blame-account-export-${new Date().toISOString().slice(0, 10)}.json`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}

async function exportAccount(
  connection: ReturnType<typeof useCloudAuth>["apiConnection"],
  password: string,
  onOpenChange: PrivacyDialogProps["onOpenChange"]
) {
  const accountExport = await createCloudApi(connection).exportAccount(password)
  downloadAccountExport(accountExport)
  toast.success("Account export downloaded", { position: "bottom-right" })
  onOpenChange(false)
}

function showClosureReceipt(receipt: CloudAccountClosureReceipt) {
  const backupDeadline = receipt.backupExpirationDeadline
    ? new Date(receipt.backupExpirationDeadline).toLocaleDateString()
    : undefined
  const description = receipt.activeDeletionCompletedAt
    ? `Active Blame cloud data has been deleted.${backupDeadline ? ` Residual backups are scheduled to expire by ${backupDeadline}.` : ""}`
    : `Deletion is queued and must complete by ${new Date(receipt.activeDeletionDeadline).toLocaleDateString()}.`
  toast.success("Account closure accepted", {
    description,
    position: "bottom-right",
  })
}

function dialogChange(
  setAction: React.Dispatch<React.SetStateAction<PrivacyAction>>,
  action: PrivacyAction
) {
  return (open: boolean) => setAction(open ? action : undefined)
}

type PrivacyDialogProps = {
  open: boolean
  onOpenChange(open: boolean): void
}
