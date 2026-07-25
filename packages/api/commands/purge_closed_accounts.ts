import AccountClosureRequest from '#models/account_closure_request'
import AccountClosureService from '#services/account_closure_service'
import FileAttachmentsService from '#services/file_attachments_service'
import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { DateTime } from 'luxon'

export default class PurgeClosedAccounts extends BaseCommand {
  static commandName = 'accounts:purge-closed'
  static description = 'Retry closed-account cleanup and remove expired closure archives'
  static options: CommandOptions = { startApp: true }

  async run() {
    const service = new AccountClosureService()
    const reconciled = await service.reconcileLedger()
    const retried = await service.retryAllPending()
    const deletedArchives = await service.deleteExpiredArchives()
    const deletedAttachmentOrphans = await new FileAttachmentsService().cleanupOrphans()
    const deadlineBreaches = await AccountClosureRequest.query()
      .where((query) =>
        query
          .where((incomplete) =>
            incomplete
              .whereNull('active_deletion_completed_at')
              .where('active_deletion_deadline', '<=', DateTime.utc().toJSDate())
          )
          .orWhereNotNull('active_deletion_deadline_breached_at')
      )
      .count('* as total')

    const breachCount = Number(deadlineBreaches[0]?.$extras.total ?? 0)
    this.logger.info(`Reconciled ${reconciled} restored account closures`)
    this.logger.info(`Retried ${retried} account closures`)
    this.logger.info(`Deleted ${deletedArchives} expired closure archives`)
    this.logger.info(`Deleted ${deletedAttachmentOrphans} orphaned attachments`)
    if (breachCount === 0) return
    this.logger.error(`${breachCount} account closures breached the active-deletion deadline`)
    this.exitCode = 1
  }
}
