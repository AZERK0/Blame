import CredentialEncryptionRotationService from '#services/credential_encryption_rotation_service'
import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class VerifyProviderCredentialsEncryption extends BaseCommand {
  static commandName = 'credentials:verify-encryption'
  static description = 'Verify that every provider credential can be decrypted'
  static options: CommandOptions = { startApp: true }

  async run() {
    const verified = await new CredentialEncryptionRotationService().verify()
    this.logger.success(`Verified ${verified} provider credentials`)
  }
}
