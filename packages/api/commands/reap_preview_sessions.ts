import PreviewReaper from '#services/preview_sessions/preview_reaper'
import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class ReapPreviewSessions extends BaseCommand {
  static commandName = 'previews:reap'
  static description = 'Suspend expired preview sessions and persist their latest remote delta'
  static options: CommandOptions = { startApp: true }

  @flags.number({ description: 'Maximum sessions reconciled by this invocation', default: 50 })
  declare limit: number

  async run() {
    const results = await new PreviewReaper().run(this.limit)
    const suspended = results.filter(({ status }) => status === 'suspended').length
    const failed = results.filter(({ status }) => status === 'failed').length
    this.logger.info(`Reconciled ${results.length} preview sessions; suspended ${suspended}`)
    if (failed) {
      this.logger.error(`${failed} preview sessions require another reconciliation attempt`)
      this.exitCode = 1
    }
  }
}
