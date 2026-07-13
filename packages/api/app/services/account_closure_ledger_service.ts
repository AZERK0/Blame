import type AccountClosureRequest from '#models/account_closure_request'
import env from '#start/env'
import { access, mkdir, open, readFile, readdir, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type AccountClosureLedgerRecord = ReturnType<typeof ledgerRecord>

export default class AccountClosureLedgerService {
  async write(closure: AccountClosureRequest) {
    const ledgerDirectory = directory()
    await mkdir(ledgerDirectory, { recursive: true, mode: 0o700 })
    const record = ledgerRecord(closure)
    const recordPath = pathForUser(closure.sourceUserId)
    try {
      const file = await open(recordPath, 'wx', 0o600)
      try {
        await file.writeFile(`${JSON.stringify(record)}\n`, 'utf8')
        await file.sync()
      } finally {
        await file.close()
      }
    } catch (error) {
      if (!isFileExistsError(error)) throw error
      await verifyExistingRecord(recordPath, record)
    }
  }

  async hasUser(userId: string) {
    try {
      await access(pathForUser(userId), constants.F_OK)
      return true
    } catch (error) {
      if (isMissingFileError(error)) return false
      throw error
    }
  }

  async records() {
    const ledgerDirectory = directory()
    try {
      const entries = await readdir(ledgerDirectory, { withFileTypes: true })
      const recordFiles = entries.filter(
        (entry) => entry.isFile() && /^[0-9a-f-]{36}\.json$/i.test(entry.name)
      )
      return Promise.all(recordFiles.map((entry) => readRecord(join(ledgerDirectory, entry.name))))
    } catch (error) {
      if (isMissingFileError(error)) return []
      throw error
    }
  }

  async delete(userId: string) {
    try {
      await unlink(pathForUser(userId))
    } catch (error) {
      if (!isMissingFileError(error)) throw error
    }
  }
}

function ledgerRecord(closure: AccountClosureRequest) {
  return {
    version: 1,
    requestId: closure.id,
    sourceUserId: closure.sourceUserId,
    emailFingerprint: closure.emailFingerprint,
    receiptTokenHash: closure.receiptTokenHash,
    requestedAt: requiredIso(closure.requestedAt.toISO()),
    activeDeletionDeadline: requiredIso(closure.activeDeletionDeadline.toISO()),
    retainUntil: requiredIso(closure.retainUntil.toISO()),
    stripeCustomerId: closure.stripeCustomerId,
    stripeSubscriptionId: closure.stripeSubscriptionId,
    stripePriceId: closure.stripePriceId,
    stripeCheckoutSessionId: closure.stripeCheckoutSessionId,
    subscriptionStatus: closure.subscriptionStatus,
    subscriptionCurrentPeriodEnd: closure.subscriptionCurrentPeriodEnd?.toISO() ?? null,
    subscriptionCancelAtPeriodEnd: closure.subscriptionCancelAtPeriodEnd,
    subscriptionCreatedAt: closure.subscriptionCreatedAt?.toISO() ?? null,
    subscriptionUpdatedAt: closure.subscriptionUpdatedAt?.toISO() ?? null,
  }
}

function directory() {
  const configuredDirectory = env.get('ACCOUNT_CLOSURE_LEDGER_DIRECTORY')
  if (configuredDirectory) return configuredDirectory
  if (env.get('NODE_ENV') === 'production') {
    throw new Error('ACCOUNT_CLOSURE_LEDGER_DIRECTORY is required in production')
  }
  return join(tmpdir(), `blame-account-closure-ledger-${process.pid}`)
}

function pathForUser(userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('Invalid closure ledger user identifier')
  return join(directory(), `${userId}.json`)
}

async function verifyExistingRecord(path: string, expected: AccountClosureLedgerRecord) {
  const existing = await readRecord(path)
  if (
    existing.requestId !== expected.requestId ||
    existing.sourceUserId !== expected.sourceUserId
  ) {
    throw new Error('Account closure ledger record conflicts with the existing tombstone')
  }
}

async function readRecord(path: string) {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!isLedgerRecord(value)) throw new Error('Invalid account closure ledger record')
  return value
}

function isLedgerRecord(value: unknown): value is AccountClosureLedgerRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    record.version === 1 &&
    typeof record.requestId === 'string' &&
    typeof record.sourceUserId === 'string' &&
    typeof record.emailFingerprint === 'string' &&
    typeof record.requestedAt === 'string' &&
    typeof record.activeDeletionDeadline === 'string' &&
    typeof record.retainUntil === 'string'
  )
}

function isFileExistsError(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

function isMissingFileError(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function requiredIso(value: string | null) {
  if (!value) throw new Error('Unable to serialize account closure ledger date')
  return value
}
