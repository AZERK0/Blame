import ProviderCredentialsService from '#services/provider_credentials_service'
import {
  resolveProviderCredentialValidator,
  saveProviderCredentialValidator,
} from '#validators/provider_credential'
import type ProviderCredential from '#models/provider_credential'
import type { HttpContext } from '@adonisjs/core/http'

export default class ProviderCredentialsController {
  async catalog({ serialize }: HttpContext) {
    return serialize({
      providers: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            'claude-sonnet-4-6': {
              id: 'claude-sonnet-4-6',
              name: 'Claude Sonnet 4.6',
              cost: { input: 0, output: 0 },
            },
            'claude-opus-4-1': {
              id: 'claude-opus-4-1',
              name: 'Claude Opus 4.1',
              cost: { input: 0, output: 0 },
            },
          },
        },
        {
          id: 'openai',
          name: 'OpenAI',
          models: {
            'gpt-5.2': {
              id: 'gpt-5.2',
              name: 'GPT-5.2',
              cost: { input: 0, output: 0 },
            },
            'gpt-5.4': {
              id: 'gpt-5.4',
              name: 'GPT-5.4',
              cost: { input: 0, output: 0 },
            },
          },
        },
        {
          id: 'google',
          name: 'Google',
          models: {
            'gemini-2.5-pro': {
              id: 'gemini-2.5-pro',
              name: 'Gemini 2.5 Pro',
              cost: { input: 0, output: 0 },
            },
            'gemini-2.5-flash': {
              id: 'gemini-2.5-flash',
              name: 'Gemini 2.5 Flash',
              cost: { input: 0, output: 0 },
            },
          },
        },
        {
          id: 'openaiCompatible',
          name: 'OpenAI Compatible',
          models: {
            custom: {
              id: 'custom',
              name: 'Custom model',
              cost: { input: 0, output: 0 },
            },
          },
        },
      ],
    })
  }

  async index({ auth, serialize }: HttpContext) {
    const credentials = await new ProviderCredentialsService().list(auth.getUserOrFail().id)

    return serialize(
      credentials.map(providerCredentialData)
    )
  }

  async store({ auth, request, serialize }: HttpContext) {
    return serialize(
      providerCredentialData(
        await new ProviderCredentialsService().save(
          auth.getUserOrFail().id,
          await request.validateUsing(saveProviderCredentialValidator)
        )
      )
    )
  }

  async storeOAuth({ auth, request, serialize }: HttpContext) {
    const credential = await new ProviderCredentialsService().saveOAuth(
      auth.getUserOrFail().id,
      oauthCredentialInput(request.body())
    )

    return serialize(
      providerCredentialData(credential)
    )
  }

  async resolve({ auth, request, serialize }: HttpContext) {
    return serialize(
      await new ProviderCredentialsService().resolve(
        auth.getUserOrFail().id,
        await request.validateUsing(resolveProviderCredentialValidator)
      )
    )
  }

  async destroy({ auth, params, response }: HttpContext) {
    await new ProviderCredentialsService().delete(auth.getUserOrFail().id, params.id)
    return response.noContent()
  }
}

function providerCredentialData(credential: ProviderCredential) {
  return {
    id: credential.id,
    userId: credential.userId,
    providerId: credential.providerId,
    label: credential.label,
    authMethod: credential.authMethod,
    accountId: credential.accountId,
    baseUrl: credential.baseUrl,
    expiresAt: credential.expiresAt?.toISO() ?? null,
    createdAt: credential.createdAt.toISO(),
    updatedAt: credential.updatedAt?.toISO() ?? null,
  }
}

function oauthCredentialInput(value: unknown) {
  if (!isRecord(value) || !isRecord(value.oauthCredentials)) {
    throw new Error('Invalid OAuth credential payload')
  }

  const credentials = value.oauthCredentials
  if (
    typeof value.providerId !== 'string' ||
    typeof value.apiKey !== 'string' ||
    typeof credentials.access !== 'string' ||
    typeof credentials.refresh !== 'string' ||
    typeof credentials.expires !== 'number'
  ) {
    throw new Error('Invalid OAuth credential payload')
  }

  return {
    providerId: value.providerId,
    label: typeof value.label === 'string' ? value.label : undefined,
    apiKey: value.apiKey,
    baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : null,
    oauthCredentials: {
      access: credentials.access,
      refresh: credentials.refresh,
      expires: credentials.expires,
      accountId: typeof credentials.accountId === 'string' ? credentials.accountId : undefined,
      email: typeof credentials.email === 'string' ? credentials.email : undefined,
      metadata: isRecord(credentials.metadata) ? credentials.metadata : undefined,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
