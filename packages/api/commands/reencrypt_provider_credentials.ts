import CredentialEncryptionRotationService from '#services/credential_encryption_rotation_service'
import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class ReencryptProviderCredentials extends BaseCommand {
  static commandName = 'credentials:reencrypt'
  static description = 'Re-encrypt provider credentials with the current application key'
  static options: CommandOptions = { startApp: true }

  async run() {
    const rotated = await new CredentialEncryptionRotationService().rotate()
    this.logger.success(`Re-encrypted ${rotated} provider credentials`)
  }
}
