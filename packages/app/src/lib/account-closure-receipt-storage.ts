import type { CloudAccountClosureReceipt } from "@/lib/cloud-api"

const storageKey = "blame.account-closure-receipt"
const listeners = new Set<() => void>()
let currentReceipt = loadReceipt()

export function getAccountClosureReceipt() {
  return currentReceipt
}

export function subscribeToAccountClosureReceipt(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function saveAccountClosureReceipt(receipt: CloudAccountClosureReceipt) {
  currentReceipt = receipt
  storage()?.setItem(storageKey, JSON.stringify(receipt))
  notifyListeners()
}

export function removeAccountClosureReceipt() {
  currentReceipt = null
  storage()?.removeItem(storageKey)
  notifyListeners()
}

export function downloadAccountClosureReceipt(
  receipt: CloudAccountClosureReceipt
) {
  const content = JSON.stringify(receipt, null, 2)
  const objectUrl = URL.createObjectURL(
    new Blob([content], { type: "application/json" })
  )
  const link = document.createElement("a")
  link.href = objectUrl
  link.download = `blame-account-closure-${receipt.requestId}.json`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}

function loadReceipt() {
  const serialized = storage()?.getItem(storageKey)
  if (!serialized) return null
  try {
    const value: unknown = JSON.parse(serialized)
    return validReceipt(value) ? value : null
  } catch {
    return null
  }
}

function validReceipt(value: unknown): value is CloudAccountClosureReceipt {
  if (!value || typeof value !== "object") return false
  const receipt = value as Record<string, unknown>
  return (
    typeof receipt.requestId === "string" &&
    (typeof receipt.receiptToken === "string" ||
      receipt.receiptToken === null) &&
    typeof receipt.status === "string" &&
    typeof receipt.activeDeletionDeadline === "string"
  )
}

function storage() {
  return typeof localStorage === "undefined" ? undefined : localStorage
}

function notifyListeners() {
  for (const listener of listeners) listener()
}
