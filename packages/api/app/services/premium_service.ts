import BillingService from '#services/billing_service'
import { Exception } from '@adonisjs/core/exceptions'
import type { PreviewSessionCommand } from '@blame/preview-runtime'

const premiumFeatures = {
  cloud_preview: 'managed cloud previews',
  cloud_storage: 'hosted file uploads',
  speech_transcription: 'cloud voice transcription',
} as const

export type PremiumFeature = keyof typeof premiumFeatures

export default class PremiumService {
  async denial(userId: string, feature: PremiumFeature) {
    const status = await new BillingService().status(userId)
    if (status.licensed) return
    return {
      code: 'PREMIUM_REQUIRED',
      feature,
      message: 'Blame Premium is required for ' + premiumFeatures[feature] + '.',
    }
  }

  async assert(userId: string, feature: PremiumFeature) {
    const denial = await this.denial(userId, feature)
    if (denial) {
      throw new Exception(denial.message, { status: 402, code: denial.code })
    }
  }
}

export function previewCommandRequiresPremium(command: PreviewSessionCommand) {
  // Cleanup and recovering existing work must remain available after expiry.
  return ![
    'stop-services',
    'stop-agent',
    'suspend-host',
    'destroy-host',
    'report-sync-conflict',
    'ack-local-sync',
  ].includes(command.type)
}
