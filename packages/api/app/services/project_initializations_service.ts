import ProjectCodePractice from '#models/project_code_practice'
import ProjectInitialization from '#models/project_initialization'
import ProjectsService from '#services/projects_service'
import type { Infer } from '@vinejs/vine/types'
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
  async show(userId: number, projectId: string) {
    await new ProjectsService().findForUser(userId, projectId)
    return this.snapshot(projectId)
  }

  async start(userId: number, projectId: string, input: StartInput) {
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

  async complete(userId: number, projectId: string, input: CompleteInput) {
    await new ProjectsService().findForUser(userId, projectId)
    const runConfigurations = input.runConfigurations ?? []
    validateRunConfigurations(runConfigurations)
    const initialization = await this.initialization(projectId)
    initialization.merge({
      status: 'done',
      step: 'completed',
      clineSessionId: input.clineSessionId ?? initialization.clineSessionId,
      setupScript: input.setupScript,
      dockerCompose: input.dockerCompose,
      runConfigurations,
      error: null,
      repairReason: null,
    })
    await initialization.save()
    await this.savePractices(projectId, input.practices)
    return this.snapshot(projectId)
  }

  async fail(userId: number, projectId: string, input: FailInput) {
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

  async repair(userId: number, projectId: string, input: RepairInput) {
    await new ProjectsService().findForUser(userId, projectId)
    const initialization = await this.initialization(projectId)
    initialization.merge({
      status: 'done',
      step: 'completed',
      clineSessionId: input.clineSessionId ?? initialization.clineSessionId,
      setupScript: input.setupScript,
      dockerCompose: input.dockerCompose,
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

  private async savePractices(projectId: string, practices: CompleteInput['practices']) {
    for (const practice of practices) {
      const projectCodePractice = await ProjectCodePractice.firstOrCreate(
        { projectId, practice: practice.practice },
        {
          projectId,
          practice: practice.practice,
          detected: practice.detected,
          enabled: defaultEnabledPractice(practice),
          comment: practice.comment,
        }
      )

      projectCodePractice.merge({
        detected: practice.detected,
        comment: practice.comment,
      })
      await projectCodePractice.save()
    }
  }
}

function defaultEnabledPractice(practice: CompleteInput['practices'][number]) {
  return practice.practice === 'coding_style' || practice.detected
}

function validateRunConfigurations(
  configurations: NonNullable<CompleteInput['runConfigurations']>
) {
  const ids = new Set(configurations.map((configuration) => configuration.id))
  if (ids.size !== configurations.length) {
    throw new Error('Run configuration ids must be unique')
  }
  if (configurations.filter((configuration) => configuration.default).length > 1) {
    throw new Error('Only one run configuration can be the default')
  }
  for (const configuration of configurations) {
    if (/[\r\n]/.test(configuration.command) || unsafeCwd(configuration.cwd)) {
      throw new Error('Run configuration is invalid')
    }
  }
}

function unsafeCwd(cwd: string) {
  return (
    cwd.startsWith('/') ||
    cwd.startsWith('\\') ||
    /^[a-zA-Z]:/.test(cwd) ||
    cwd.split(/[\\/]/).includes('..')
  )
}
