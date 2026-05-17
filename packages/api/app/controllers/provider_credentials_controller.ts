import ProviderCredentialsService from '#services/provider_credentials_service'
import ProviderCredentialTransformer from '#transformers/provider_credential_transformer'
import {
  resolveProviderCredentialValidator,
  saveProviderCredentialValidator,
} from '#validators/provider_credential'
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
          id: 'openai-compatible',
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
    return serialize(
      (await new ProviderCredentialsService().list(auth.getUserOrFail().id)).map((credential) =>
        ProviderCredentialTransformer.transform(credential)
      )
    )
  }

  async store({ auth, request, serialize }: HttpContext) {
    return serialize(
      ProviderCredentialTransformer.transform(
        await new ProviderCredentialsService().save(
          auth.getUserOrFail().id,
          await request.validateUsing(saveProviderCredentialValidator)
        )
      )
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
