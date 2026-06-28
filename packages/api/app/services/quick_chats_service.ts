import Project from '#models/project'
import QuickChat from '#models/quick_chat'
import QuickChatAgentRun from '#models/quick_chat_agent_run'
import QuickChatMessage from '#models/quick_chat_message'
import type { UserStoryAgentActivity } from '#models/user_story'
import { activityWithArtifact, artifactDetail } from '#services/agent_activity_artifacts'
import ProjectsService from '#services/projects_service'
import type {
  createQuickChatAgentRunValidator,
  updateQuickChatAgentRunValidator,
} from '#validators/quick_chat_agent_run'
import type {
  createQuickChatMessageValidator,
  createQuickChatValidator,
  listQuickChatsValidator,
  updateQuickChatValidator,
} from '#validators/quick_chat'
import { DateTime } from 'luxon'
import type { Infer } from '@vinejs/vine/types'

type ListQuickChatsInput = Infer<typeof listQuickChatsValidator>
type CreateQuickChatInput = Infer<typeof createQuickChatValidator>
type UpdateQuickChatInput = Infer<typeof updateQuickChatValidator>
type CreateQuickChatMessageInput = Infer<typeof createQuickChatMessageValidator>
type CreateQuickChatAgentRunInput = Infer<typeof createQuickChatAgentRunValidator>
type UpdateQuickChatAgentRunInput = Infer<typeof updateQuickChatAgentRunValidator>

const maxAgentActivities = 80

export default class QuickChatsService {
  async list(userId: number, input: ListQuickChatsInput) {
    await new ProjectsService().findForUser(userId, input.projectId)
    return QuickChat.query()
      .where('projectId', input.projectId)
      .preload('messages', orderMessages)
      .preload('agentRuns', orderAgentRuns)
      .orderBy('updatedAt', 'desc')
      .orderBy('createdAt', 'desc')
  }

  async find(userId: number, id: number) {
    return this.quickChatQuery(userId)
      .where('id', id)
      .preload('messages', orderMessages)
      .preload('agentRuns', orderAgentRuns)
      .firstOrFail()
  }

  async create(userId: number, input: CreateQuickChatInput) {
    await new ProjectsService().findForUser(userId, input.projectId)
    const quickChat = await QuickChat.create({
      projectId: input.projectId,
      title: input.title,
      workspace: input.workspace ?? null,
      agentStatus: input.agentStatus ?? null,
      clineSessionId: input.clineSessionId ?? null,
      agentProviderId: input.agentProviderId ?? null,
      agentModelId: input.agentModelId ?? null,
      agentLastEvent: input.agentLastEvent ?? null,
      agentLastError: input.agentLastError ?? null,
      agentActivities: input.agentActivities ?? null,
      agentFinalResponse: input.agentFinalResponse ?? null,
      agentUsage: input.agentUsage ?? null,
      agentSessionSummary: input.agentSessionSummary ?? null,
    })
    await quickChat.load('messages')
    await quickChat.load('agentRuns')
    return quickChat
  }

  async update(userId: number, id: number, input: UpdateQuickChatInput) {
    const quickChat = await this.find(userId, id)
    const update = await this.updateInput(quickChat, input)
    quickChat.merge(update)
    await quickChat.save()
    await quickChat.load('messages', orderMessages)
    await quickChat.load('agentRuns', orderAgentRuns)
    return quickChat
  }

  async createMessage(userId: number, id: number, input: CreateQuickChatMessageInput) {
    await this.find(userId, id)
    return QuickChatMessage.create({
      author: 'You',
      body: input.body,
      codeSelectionAttachments: input.codeSelectionAttachments ?? null,
      fileAttachments: input.fileAttachments ?? null,
      quickChatId: id,
    })
  }

  async createAgentRun(userId: number, id: number, input: CreateQuickChatAgentRunInput) {
    const quickChat = await this.find(userId, id)
    if (input.messageId && !quickChat.messages.some((message) => message.id === input.messageId)) {
      throw new Error('Quick chat message not found.')
    }
    return QuickChatAgentRun.create({
      activities: [],
      clineSessionId: input.clineSessionId ?? null,
      finalResponse: null,
      kind: input.kind,
      messageId: input.messageId ?? null,
      quickChatId: quickChat.id,
      sessionSummary: null,
      status: input.status ?? 'running',
      usage: null,
    })
  }

  async updateAgentRun(
    userId: number,
    id: number,
    runId: number,
    input: UpdateQuickChatAgentRunInput
  ) {
    const quickChat = await this.find(userId, id)
    const run = await this.agentRunQuery(quickChat, runId)
    const update = await this.agentRunUpdateInput(quickChat, run, input)
    run.merge(update)
    await run.save()
    return run
  }

  async agentRunActivityDetail(userId: number, id: number, runId: number, activityId: string) {
    const quickChat = await this.find(userId, id)
    const run = await this.agentRunQuery(quickChat, runId)
    const activity = run.activities?.find((item) => item.id === activityId)
    if (!activity) throw new Error('Agent activity not found.')
    if (!activity.detailArtifact) return { detail: activity.detail }
    return { detail: await artifactDetail(quickChat.workspace, activity) }
  }

  async delete(userId: number, id: number) {
    const quickChat = await this.find(userId, id)
    await quickChat.delete()
  }

  private quickChatQuery(userId: number) {
    return QuickChat.query().whereIn(
      'projectId',
      Project.query().select('id').where('userId', userId)
    )
  }

  private async updateInput(quickChat: QuickChat, input: UpdateQuickChatInput) {
    const { agentActivity, ...update } = input
    if (!agentActivity) return update
    const activity = await activityWithArtifact(
      quickChat.workspace,
      quickChat.clineSessionId,
      agentActivity
    )
    return {
      ...update,
      agentActivities: upsertActivity(quickChat.agentActivities ?? [], activity),
    }
  }

  private agentRunQuery(quickChat: QuickChat, runId: number) {
    return QuickChatAgentRun.query()
      .where('quickChatId', quickChat.id)
      .where('id', runId)
      .firstOrFail()
  }

  private async agentRunUpdateInput(
    quickChat: QuickChat,
    run: QuickChatAgentRun,
    input: UpdateQuickChatAgentRunInput
  ) {
    const { agentActivity, ...update } = input
    const nextUpdate = {
      ...update,
      ...agentRunCompletedAtUpdate(update),
    }
    if (!agentActivity) return nextUpdate
    const activity = await activityWithArtifact(
      quickChat.workspace,
      run.clineSessionId,
      agentActivity
    )
    return {
      ...nextUpdate,
      activities: upsertActivity(run.activities ?? [], activity),
    }
  }
}

function upsertActivity(activities: UserStoryAgentActivity[], input: UserStoryAgentActivity) {
  const exists = activities.some((activity) => activity.id === input.id)
  const next = exists
    ? activities.map((activity) => (activity.id === input.id ? input : activity))
    : [...activities, input]
  return next.slice(Math.max(0, next.length - maxAgentActivities))
}

function terminalStatus(status: string | undefined) {
  return status === 'completed' || status === 'failed'
}

function agentRunCompletedAtUpdate(input: { completedAt?: DateTime | null; status?: string }) {
  if (input.completedAt !== undefined) return { completedAt: input.completedAt }
  if (terminalStatus(input.status)) return { completedAt: DateTime.now() }
  return {}
}

function orderMessages(query: ReturnType<typeof QuickChatMessage.query>) {
  query.orderBy('quickChatId', 'asc').orderBy('createdAt', 'asc').orderBy('id', 'asc')
}

function orderAgentRuns(query: ReturnType<typeof QuickChatAgentRun.query>) {
  query.orderBy('quickChatId', 'asc').orderBy('createdAt', 'asc').orderBy('id', 'asc')
}
