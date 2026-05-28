import ProjectCodePractice, { type ProjectCodePracticeKey } from '#models/project_code_practice'
import ProjectsService from '#services/projects_service'
import type { Infer } from '@vinejs/vine/types'
import type { updateProjectCodePracticeValidator } from '#validators/project_code_practice'

type UpdateProjectCodePracticeInput = Infer<typeof updateProjectCodePracticeValidator>

const practiceOrder: ProjectCodePracticeKey[] = [
  'coding_style',
  'unit_tests',
  'layered_architecture',
  'commit_message_convention',
]

export default class ProjectCodePracticesService {
  async list(userId: number, projectId: string) {
    await new ProjectsService().findForUser(userId, projectId)
    const practices = await ProjectCodePractice.query().where('projectId', projectId)
    return practices.sort((left, right) => this.order(left.practice) - this.order(right.practice))
  }

  async update(
    userId: number,
    projectId: string,
    practice: string,
    input: UpdateProjectCodePracticeInput
  ) {
    await new ProjectsService().findForUser(userId, projectId)
    const projectCodePractice = await ProjectCodePractice.query()
      .where('projectId', projectId)
      .where('practice', practice)
      .firstOrFail()

    projectCodePractice.enabled = input.enabled
    await projectCodePractice.save()
    return projectCodePractice
  }

  private order(practice: ProjectCodePracticeKey) {
    const index = practiceOrder.indexOf(practice)
    return index === -1 ? practiceOrder.length : index
  }
}
