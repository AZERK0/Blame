import ProjectCodePractice from '#models/project_code_practice'
import ProjectInitialization from '#models/project_initialization'
import ProjectsService from '#services/projects_service'
import type { Infer } from '@vinejs/vine/types'
import { Exception } from '@adonisjs/core/exceptions'
import { parsePreviewManifest, type PreviewManifest } from '@blame/preview-contract'
import type {
  completeProjectInitializationValidator,
  failProjectInitializationValidator,
  repairProjectInitializationValidator,
  startProjectInitializationValidator,
} from '#validators/project_initialization'

type StartInput = Infer<typeof startProjectInitializationValidator>
type CompleteInput = Infer<typeof completeProjectInitializationValidator>
type FailInput = Infer<typeof failProjectInitializationValidator>
type RepairInput = Infer<typeof repairProjectInitializationValidator>

export default class ProjectInitializationsService {
  async show(userId: string, projectId: string) {
    await new ProjectsService().findForUser(userId, projectId)
    return this.snapshot(projectId)
  }

  async start(userId: string, projectId: string, input: StartInput) {
    await new ProjectsService().findForUser(userId, projectId)
    const initialization = await this.initialization(projectId)
    initialization.merge({
      status: 'running',
      step: 'agent_analysis',
      clineSessionId: input.clineSessionId ?? null,
      agentProviderId: input.providerId,
      agentModelId: input.modelId,
      error: null,
    })
    await initialization.save()
    return this.snapshot(projectId)
  }

  async complete(userId: string, projectId: string, input: CompleteInput) {
    await new ProjectsService().findForUser(userId, projectId)
    const runConfigurations = input.runConfigurations ?? []
    const previewManifest = validatedPreviewManifest(input.previewManifest)
    validateRunConfigurations(runConfigurations, previewManifest)
    const initialization = await this.initialization(projectId)
    initialization.merge({
      status: 'done',
      step: 'completed',
      clineSessionId: input.clineSessionId ?? initialization.clineSessionId,
      previewManifest: previewManifest ?? null,
      setupScript: input.setupScript,
      dockerCompose: input.dockerCompose,
      runConfigurations,
      error: null,
      repairReason: null,
    })
    await initialization.save()
    return this.snapshot(projectId)
  }

  async fail(userId: string, projectId: string, input: FailInput) {
    await new ProjectsService().findForUser(userId, projectId)
    const initialization = await this.initialization(projectId)
    initialization.merge({
      status: 'error',
      step: 'failed',
      clineSessionId: input.clineSessionId ?? initialization.clineSessionId,
      error: input.error,
    })
    await initialization.save()
    return this.snapshot(projectId)
  }

  async repair(userId: string, projectId: string, input: RepairInput) {
    await new ProjectsService().findForUser(userId, projectId)
    const initialization = await this.initialization(projectId)
    const runConfigurations = input.runConfigurations ?? initialization.runConfigurations ?? []
    const previewManifest =
      validatedPreviewManifest(input.previewManifest) ?? initialization.previewManifest
    validateRunConfigurations(runConfigurations, previewManifest)
    initialization.merge({
      status: 'done',
      step: 'completed',
      clineSessionId: input.clineSessionId ?? initialization.clineSessionId,
      previewManifest,
      setupScript: input.setupScript,
      dockerCompose: input.dockerCompose,
      runConfigurations,
      error: null,
      repairReason: input.reason,
    })
    await initialization.save()
    return this.snapshot(projectId)
  }

  private initialization(projectId: string) {
    return ProjectInitialization.firstOrCreate(
      { projectId },
      { projectId, status: 'pending', step: 'pending' }
    )
  }

  private async snapshot(projectId: string) {
    return {
      initialization: await ProjectInitialization.find(projectId),
      practices: await ProjectCodePractice.query()
        .where('projectId', projectId)
        .orderBy('practice'),
    }
  }
}

function validatedPreviewManifest(value: unknown) {
  if (value === undefined) return undefined
  try {
    return parsePreviewManifest(value)
  } catch (error) {
    throw new Exception(error instanceof Error ? error.message : 'Preview manifest is invalid', {
      status: 422,
      code: 'E_PREVIEW_MANIFEST_INVALID',
      cause: error,
    })
  }
}

function validateRunConfigurations(
  configurations: NonNullable<CompleteInput['runConfigurations']>,
  manifest: PreviewManifest | null | undefined
) {
  const ids = new Set(configurations.map((configuration) => configuration.id))
  if (ids.size !== configurations.length) {
    invalidRunConfiguration('Run configuration ids must be unique')
  }
  if (configurations.filter((configuration) => configuration.default).length > 1) {
    invalidRunConfiguration('Only one run configuration can be the default')
  }
  for (const configuration of configurations) {
    if (
      /[\r\n]/.test(configuration.command) ||
      unsafeCwd(configuration.cwd) ||
      invalidPreviewUrl(configuration.previewUrl) ||
      invalidRunConfigurationTopology(configuration, manifest)
    ) {
      invalidRunConfiguration('Run configuration is invalid')
    }
  }
}

function invalidRunConfiguration(message: string): never {
  throw new Exception(message, {
    status: 422,
    code: 'E_RUN_CONFIGURATION_INVALID',
  })
}

function invalidRunConfigurationTopology(
  configuration: NonNullable<CompleteInput['runConfigurations']>[number],
  manifest: PreviewManifest | null | undefined
) {
  const services = configuration.services ?? []
  if (requiresContainerServices(configuration.category) && !services.length) return true
  if (configuration.category && !configuration.scopes?.length) return true
  if (configuration.category === 'web' && !configuration.previewService) return true
  if (configuration.category && configuration.category !== 'web' && configuration.previewService)
    return true
  if (configuration.previewService && !services.includes(configuration.previewService)) return true
  if (!manifest) return false
  const serviceIds = new Set(manifest.services.map(({ id }) => id))
  if (services.some((service) => !serviceIds.has(service))) return true
  if (
    configuration.category &&
    configuration.category !== 'web' &&
    manifest.services.some(({ id, kind }) => services.includes(id) && kind === 'preview')
  ) {
    return true
  }
  const preview = manifest.services.find(({ id }) => id === configuration.previewService)
  return Boolean(configuration.previewService && preview?.kind !== 'preview')
}

function requiresContainerServices(
  category: NonNullable<CompleteInput['runConfigurations']>[number]['category']
) {
  return category === 'web' || category === 'service'
}

function invalidPreviewUrl(previewUrl: string | null | undefined) {
  return Boolean(previewUrl && /[\r\n]/.test(previewUrl))
}

function unsafeCwd(cwd: string) {
  return (
    cwd.startsWith('/') ||
    cwd.startsWith('\\') ||
    /^[a-zA-Z]:/.test(cwd) ||
    cwd.split(/[\\/]/).includes('..')
  )
}
