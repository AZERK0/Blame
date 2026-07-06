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
  async list(userId: string, input: ListQuickChatsInput) {
    await new ProjectsService().findForUser(userId, input.projectId)
    const query = QuickChat.query()
      .where('projectId', input.projectId)
      .orderBy('updatedAt', 'desc')
      .orderBy('createdAt', 'desc')
    if (input.view === 'summary') return query
    return query.preload('messages', orderMessages).preload('agentRuns', orderAgentRuns)
  }

  async find(userId: string, id: string) {
    return this.quickChatQuery(userId)
      .where('id', id)
      .preload('messages', orderMessages)
      .preload('agentRuns', orderAgentRuns)
      .firstOrFail()
  }

  async create(userId: string, input: CreateQuickChatInput) {
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

  async update(userId: string, id: string, input: UpdateQuickChatInput) {
    const quickChat = await this.find(userId, id)
    const update = await this.updateInput(quickChat, input)
    quickChat.merge(update)
    await quickChat.save()
    await quickChat.load('messages', orderMessages)
    await quickChat.load('agentRuns', orderAgentRuns)
    return quickChat
  }

  async createMessage(userId: string, id: string, input: CreateQuickChatMessageInput) {
    await this.find(userId, id)
    return QuickChatMessage.create({
      author: 'You',
      body: input.body,
      codeSelectionAttachments: input.codeSelectionAttachments ?? null,
      fileAttachments: input.fileAttachments ?? null,
      quickChatId: id,
    })
  }

  async undoMessage(
    userId: string,
    id: string,
    messageId: string,
    clineSessionId?: string
  ) {
    const quickChat = await this.find(userId, id)
    const message = quickChat.messages.find((item) => item.id === messageId)
    if (!message) throw new Error('Quick chat message not found.')
    const deletedMessageIds = new Set(
      quickChat.messages.filter((item) => sameOrAfter(item, message)).map((item) => item.id)
    )
    const deletedRunIds = new Set(
      quickChatRunIdsFromMessages(quickChat.agentRuns, messageId, deletedMessageIds)
    )
    await deleteQuickChatRuns(quickChat.id, [...deletedRunIds])
    await deleteQuickChatMessages(quickChat.id, [...deletedMessageIds])
    const remainingRuns = quickChat.agentRuns.filter((run) => !deletedRunIds.has(run.id))
    quickChat.merge(quickChatUndoUpdate(remainingRuns, clineSessionId))
    await quickChat.save()
    return this.find(userId, id)
  }

  async createAgentRun(userId: string, id: string, input: CreateQuickChatAgentRunInput) {
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
    userId: string,
    id: string,
    runId: string,
    input: UpdateQuickChatAgentRunInput
  ) {
    const quickChat = await this.find(userId, id)
    const run = await this.agentRunQuery(quickChat, runId)
    const update = await this.agentRunUpdateInput(quickChat, run, input)
    run.merge(update)
    await run.save()
    return run
  }

  async agentRunActivityDetail(userId: string, id: string, runId: string, activityId: string) {
    const quickChat = await this.find(userId, id)
    const run = await this.agentRunQuery(quickChat, runId)
    const activity = run.activities?.find((item) => item.id === activityId)
    if (!activity) throw new Error('Agent activity not found.')
    if (!activity.detailArtifact) return { detail: activity.detail }
    return { detail: await artifactDetail(quickChat.workspace, activity) }
  }

  async delete(userId: string, id: string) {
    const quickChat = await this.find(userId, id)
    await quickChat.delete()
  }

  private quickChatQuery(userId: string) {
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

  private agentRunQuery(quickChat: QuickChat, runId: string) {
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

function quickChatRunIdsFromMessages(
  runs: QuickChatAgentRun[],
  messageId: string,
  deletedMessageIds: Set<string>
) {
  const index = runs.findIndex((run) => run.messageId === messageId)
  if (index >= 0) return runs.slice(index).map((run) => run.id)
  return runs
    .filter((run) => run.messageId && deletedMessageIds.has(run.messageId))
    .map((run) => run.id)
}

async function deleteQuickChatRuns(quickChatId: string, ids: string[]) {
  if (!ids.length) return
  await QuickChatAgentRun.query().where('quickChatId', quickChatId).whereIn('id', ids).delete()
}

async function deleteQuickChatMessages(quickChatId: string, ids: string[]) {
  if (!ids.length) return
  await QuickChatMessage.query().where('quickChatId', quickChatId).whereIn('id', ids).delete()
}

function quickChatUndoUpdate(
  remainingRuns: QuickChatAgentRun[],
  clineSessionId?: string
): Partial<QuickChat> {
  const lastRun = remainingRuns.at(-1)
  return {
    agentActivities: lastRun?.activities ?? [],
    agentFinalResponse: lastRun?.finalResponse ?? null,
    agentLastError: null,
    agentLastEvent: lastRun ? agentRunLastEvent(lastRun) : null,
    agentSessionSummary: lastRun?.sessionSummary ?? null,
    agentStatus: null,
    agentUsage: lastRun?.usage ?? null,
    clineSessionId: clineSessionId ?? lastRun?.clineSessionId ?? null,
  }
}

function agentRunLastEvent(run: QuickChatAgentRun) {
  if (run.status === 'failed') return run.finalResponse ?? 'Agent run failed.'
  if (run.status === 'running') return 'Agent is running.'
  return run.finalResponse ?? 'Agent run completed.'
}

function sameOrAfter<T extends { createdAt: DateTime; id: string }>(item: T, target: T) {
  const delta = item.createdAt.toMillis() - target.createdAt.toMillis()
  return delta > 0 || (delta === 0 && item.id.localeCompare(target.id) >= 0)
}
