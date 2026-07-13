import * as React from "react"
import {
  CheckCircle2Icon,
  Clock3Icon,
  DownloadIcon,
  LoaderCircleIcon,
  MailIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { useCloudAuth } from "@/context/cloud-auth"
import {
  downloadAccountClosureReceipt,
  removeAccountClosureReceipt,
  saveAccountClosureReceipt,
} from "@/lib/account-closure-receipt-storage"
import {
  createCloudApi,
  type CloudAccountClosureReceipt,
} from "@/lib/cloud-api"

export function AccountClosureReceiptPage({
  receipt,
}: {
  receipt: CloudAccountClosureReceipt
}) {
  const statusCheck = useClosureStatusCheck(receipt)

  return (
    <main className="light min-h-svh bg-background p-6 text-foreground">
      <section className="mx-auto w-full max-w-2xl rounded-2xl border bg-card p-6 shadow-sm md:p-8">
        <ReceiptHeader receipt={receipt} />
        <ReceiptDetails receipt={receipt} />
        <ReceiptActions
          pending={statusCheck.pending}
          receipt={receipt}
          onRefresh={() => void statusCheck.refresh()}
        />
      </section>
    </main>
  )
}

function ReceiptHeader({ receipt }: { receipt: CloudAccountClosureReceipt }) {
  const complete = receipt.status === "completed"
  return (
    <header className="border-b pb-6">
      <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        {complete ? <CheckCircle2Icon /> : <Clock3Icon />}
      </div>
      <h1 className="mt-5 font-heading text-3xl font-semibold">
        Account closure receipt
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {complete
          ? "Your active Blame cloud data has been deleted."
          : "Your account is disabled and active cloud deletion remains in progress."}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Keep this receipt private because it contains the credential used to
        check status.
      </p>
    </header>
  )
}

function ReceiptDetails({ receipt }: { receipt: CloudAccountClosureReceipt }) {
  return (
    <dl className="grid gap-4 border-b py-6 text-sm">
      <ReceiptValue label="Request ID" value={receipt.requestId} />
      <ReceiptValue label="Status" value={statusLabel(receipt.status)} />
      <ReceiptValue
        label="Active deletion deadline"
        value={formatDate(receipt.activeDeletionDeadline)}
      />
      <ReceiptValue
        label="Active deletion completed"
        value={formatDate(receipt.activeDeletionCompletedAt)}
      />
      <ReceiptValue
        label="Backup rotation deadline"
        value={formatDate(receipt.backupExpirationDeadline)}
      />
    </dl>
  )
}

function ReceiptActions({
  onRefresh,
  pending,
  receipt,
}: {
  onRefresh(): void
  pending: boolean
  receipt: CloudAccountClosureReceipt
}) {
  return (
    <div className="flex flex-wrap gap-2 pt-6">
      <Button type="button" onClick={onRefresh} disabled={pending}>
        {pending ? <LoaderCircleIcon className="animate-spin" /> : null}
        Check status
      </Button>
      <ReceiptSecondaryActions receipt={receipt} />
    </div>
  )
}

function ReceiptSecondaryActions({ receipt }: ReceiptProps) {
  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => downloadAccountClosureReceipt(receipt)}
      >
        <DownloadIcon /> Save receipt
      </Button>
      <Button type="button" variant="outline" asChild>
        <a
          href={`mailto:${receipt.supportContact}?subject=Account closure ${receipt.requestId}`}
        >
          <MailIcon /> Contact privacy support
        </a>
      </Button>
      <Button
        type="button"
        variant="ghost"
        onClick={removeAccountClosureReceipt}
      >
        Return to sign in
      </Button>
    </>
  )
}

type ReceiptProps = { receipt: CloudAccountClosureReceipt }

function ReceiptValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium break-all">{value}</dd>
    </div>
  )
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Pending"
}

function statusLabel(status: string) {
  if (status === "completed") return "Completed"
  if (status === "pending_external_cleanup") return "External cleanup pending"
  return "Active deletion pending"
}

function showMissingToken() {
  toast.error("This receipt cannot be checked automatically", {
    description: "Contact privacy@blame.so with the request ID.",
    position: "bottom-right",
  })
}

function useClosureStatusCheck(receipt: CloudAccountClosureReceipt) {
  const auth = useCloudAuth()
  const [pending, setPending] = React.useState(false)

  async function refresh() {
    if (!receipt.receiptToken) return showMissingToken()
    setPending(true)
    try {
      const latest = await createCloudApi(auth.apiConnection).closureStatus(
        receipt.requestId,
        receipt.receiptToken
      )
      saveAccountClosureReceipt({
        ...latest,
        receiptToken: receipt.receiptToken,
      })
      toast.success("Closure status updated", { position: "bottom-right" })
    } catch (error) {
      toast.error("Unable to verify closure status", {
        description:
          error instanceof Error ? error.message : "Please try again.",
        position: "bottom-right",
      })
    } finally {
      setPending(false)
    }
  }

  return { pending, refresh }
}
