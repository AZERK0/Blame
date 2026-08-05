import PreviewProjectBaselineService from '#services/preview_baselines/preview_project_baseline_service'
import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class GcPreviewBaselines extends BaseCommand {
  static commandName = 'previews:gc-baselines'
  static description = 'Delete expired and unreferenced preview baselines'
  static options: CommandOptions = { startApp: true }

  @flags.number({ description: 'Maximum baseline rows processed by this invocation', default: 25 })
  declare limit: number

  async run() {
    const result = await new PreviewProjectBaselineService().gc(this.limit)
    this.logger.info(`Processed preview baselines; deleted ${result.deleted}`)
    if (result.failed) {
      this.logger.error(`${result.failed} preview baselines require another cleanup attempt`)
      this.exitCode = 1
    }
  }
}
