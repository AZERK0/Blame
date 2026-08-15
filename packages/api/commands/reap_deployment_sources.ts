import ProjectDeploymentsService from '#services/deployments/project_deployments_service'
import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class ReapDeploymentSources extends BaseCommand {
  static commandName = 'deployments:reap-sources'
  static description = 'Delete expired temporary deployment source archives'
  static options: CommandOptions = { startApp: true }

  @flags.number({ description: 'Maximum source archives processed', default: 100 })
  declare limit: number

  async run() {
    const result = await new ProjectDeploymentsService().cleanupExpired(this.limit)
    this.logger.info(
      `Processed ${result.processed} expired deployment sources; deleted ${result.deleted}`
    )
    if (result.deleted !== result.processed) this.exitCode = 1
  }
}
