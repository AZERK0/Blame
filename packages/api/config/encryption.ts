import env from '#start/env'
import { defineConfig, drivers } from '@adonisjs/core/encryption'

const currentAppKey = env.get('APP_KEY')
const previousAppKey = env.get('APP_KEY_PREVIOUS')
const encryptionKeys = previousAppKey?.release() ? [currentAppKey, previousAppKey] : [currentAppKey]

const encryptionConfig = defineConfig({
  /**
   * Default encryption driver used by the application.
   */
  default: 'gcm',

  list: {
    gcm: drivers.aes256gcm({
      /**
       * Keys used for encryption/decryption.
       * First key encrypts, all keys are tried for decryption.
       */
      keys: encryptionKeys,

      /**
       * Stable identifier for this driver.
       */
      id: 'gcm',
    }),
  },
})

export default encryptionConfig

/**
 * Inferring types for the list of encryptors you have configured
 * in your application.
 */
declare module '@adonisjs/core/types' {
  export interface EncryptorsList extends InferEncryptors<typeof encryptionConfig> {}
}
