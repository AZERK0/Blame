import PreviewSessionService from '#services/preview_sessions/preview_session_service'
import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class CheckpointPreviewSessions extends BaseCommand {
  static commandName = 'previews:checkpoint'
  static description = 'Export active preview journals to durable object storage'
  static options: CommandOptions = { startApp: true }

  @flags.number({ description: 'Maximum active sessions checked by this invocation', default: 50 })
  declare limit: number

  async run() {
    const results = await new PreviewSessionService().checkpointActive(this.limit)
    const exported = results.filter(({ status }) => status === 'exported').length
    const failed = results.filter(({ status }) => status === 'failed').length
    this.logger.info(`Checked ${results.length} active preview sessions; exported ${exported}`)
    if (failed) {
      this.logger.error(`${failed} preview checkpoints failed and must be retried`)
      this.exitCode = 1
    }
  }
}
