import ProjectCodePractice from '#models/project_code_practice'
import ProjectInitialization from '#models/project_initialization'
import ProjectsService from '#services/projects_service'
import type { Infer } from '@vinejs/vine/types'
import type {
  completeProjectInitializationValidator,
  failProjectInitializationValidator,
  startProjectInitializationValidator,
} from '#validators/project_initialization'

type StartInput = Infer<typeof startProjectInitializationValidator>
type CompleteInput = Infer<typeof completeProjectInitializationValidator>
type FailInput = Infer<typeof failProjectInitializationValidator>

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
    const initialization = await this.initialization(projectId)
    initialization.merge({
      status: 'done',
      step: 'completed',
      clineSessionId: input.clineSessionId ?? initialization.clineSessionId,
      setupScript: input.setupScript,
      dockerCompose: input.dockerCompose,
      error: null,
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
          enabled: practice.detected,
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
