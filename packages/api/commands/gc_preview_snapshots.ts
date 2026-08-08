import PreviewSessionService from '#services/preview_sessions/preview_session_service'
import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class GcPreviewSnapshots extends BaseCommand {
  static commandName = 'previews:gc-snapshots'
  static description = 'Release expired or excess private preview snapshots'
  static options: CommandOptions = { startApp: true }

  @flags.number({ description: 'Maximum suspended sessions processed', default: 50 })
  declare limit: number

  async run() {
    const results = await new PreviewSessionService().releaseSuspendedSnapshots(this.limit)
    const released = results.filter(({ status }) => status === 'released').length
    const failed = results.filter(({ status }) => status === 'failed').length
    this.logger.info(
      `Processed ${results.length} suspended previews; released ${released} snapshots`
    )
    if (failed) {
      this.logger.error(`${failed} suspended preview snapshots require another cleanup attempt`)
      this.exitCode = 1
    }
  }
}
