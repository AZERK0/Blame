import Project from '#models/project'
import QuickChat from '#models/quick_chat'
import QuickChatAgentRun from '#models/quick_chat_agent_run'
import QuickChatMessage from '#models/quick_chat_message'
import type { UserStoryAgentActivity } from '#models/user_story'
import {
  activityWithArtifact,
  artifactDetail,
  deleteActivityArtifacts,
} from '#services/agent_activity_artifacts'
import {
  persistQuickChatRunActivity,
  quickChatRunActivities,
  quickChatRunActivity,
} from '#services/agent_run_activity_log'
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
import db from '@adonisjs/lucid/services/db'
import { Exception } from '@adonisjs/core/exceptions'
import FileAttachmentsService from '#services/file_attachments_service'
import type FileAttachment from '#models/file_attachment'

type ListQuickChatsInput = Infer<typeof listQuickChatsValidator>
type CreateQuickChatInput = Infer<typeof createQuickChatValidator>
type UpdateQuickChatInput = Infer<typeof updateQuickChatValidator>
type CreateQuickChatMessageInput = Infer<typeof createQuickChatMessageValidator>
type CreateQuickChatAgentRunInput = Infer<typeof createQuickChatAgentRunValidator>
type UpdateQuickChatAgentRunInput = Infer<typeof updateQuickChatAgentRunValidator>

const maxAgentActivities = 512

export default class QuickChatsService {
  private fileAttachments = new FileAttachmentsService()

  async list(userId: string, input: ListQuickChatsInput) {
    await new ProjectsService().findForUser(userId, input.projectId)
    const query = QuickChat.query()
      .where('projectId', input.projectId)
      .orderBy('updatedAt', 'desc')
      .orderBy('createdAt', 'desc')
    if (input.view === 'summary') return query
    const quickChats = await query
      .preload('messages', (messages) => {
        orderMessages(messages)
        messages.preload('storedFileAttachments')
      })
      .preload('agentRuns', orderAgentRuns)
    await this.prepareDownloads(quickChats)
    return quickChats
  }

  async find(userId: string, id: string) {
    const quickChat = await this.quickChatQuery(userId)
      .where('id', id)
      .preload('messages', (messages) => {
        orderMessages(messages)
        messages.preload('storedFileAttachments')
      })
      .preload('agentRuns', orderAgentRuns)
      .firstOrFail()
    await this.prepareDownloads([quickChat])
    return quickChat
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
    const attachments = await this.fileAttachments.resolveInputs(userId, input.fileAttachments)
    const messageId = await db.transaction(async (transaction) => {
      const message = await QuickChatMessage.create(
        {
          author: 'You',
          body: input.body,
          codeSelectionAttachments: input.codeSelectionAttachments ?? null,
          legacyFileAttachments: null,
          quickChatId: id,
        },
        { client: transaction }
      )
      await this.fileAttachments.syncOwner(
        userId,
        'quickChatMessage',
        message.id,
        attachments,
        transaction
      )
      return message.id
    })
    return this.messageForDelivery(messageId)
  }

  async undoMessage(
    userId: string,
    id: string,
    messageId: string,
    runId: string,
    clineSessionId?: string
  ) {
    await db.transaction(async (transaction) => {
      const quickChat = await QuickChat.query({ client: transaction })
        .whereIn(
          'projectId',
          Project.query({ client: transaction }).select('id').where('userId', userId)
        )
        .where('id', id)
        .preload('messages', orderMessages)
        .preload('agentRuns', orderAgentRuns)
        .forUpdate()
        .firstOrFail()
      const { message, targetRun } = assertQuickChatUndoTarget(quickChat, messageId, runId)
      const deletedMessageIds = new Set(
        quickChat.messages.filter((item) => sameOrAfter(item, message)).map((item) => item.id)
      )
      const deletedRunIds = new Set(
        quickChat.agentRuns.slice(quickChat.agentRuns.indexOf(targetRun)).map((run) => run.id)
      )
      await this.fileAttachments.markOwnersDetached(
        'quickChatMessage',
        [...deletedMessageIds],
        transaction
      )
      await deleteQuickChatRuns(quickChat.id, [...deletedRunIds], transaction)
      await deleteQuickChatMessages(quickChat.id, [...deletedMessageIds], transaction)
      const remainingRuns = quickChat.agentRuns.filter((run) => !deletedRunIds.has(run.id))
      quickChat.useTransaction(transaction)
      quickChat.merge(quickChatUndoUpdate(remainingRuns, clineSessionId))
      await quickChat.save()
    })
    return this.find(userId, id)
  }

  async validateMessageUndo(userId: string, id: string, messageId: string, runId: string) {
    assertQuickChatUndoTarget(await this.find(userId, id), messageId, runId)
  }

  async createAgentRun(userId: string, id: string, input: CreateQuickChatAgentRunInput) {
    const quickChat = await this.find(userId, id)
    if (input.messageId && !quickChat.messages.some((message) => message.id === input.messageId)) {
      throw new Error('Quick chat message not found.')
    }
    return QuickChatAgentRun.create({
      activities: [],
      checkpointRunCount: input.checkpointRunCount ?? null,
      clineSessionId: input.clineSessionId ?? null,
      diffEndRef: null,
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
    const activity =
      run.activities?.find((item) => item.id === activityId) ??
      (await quickChatRunActivity(run.id, activityId))
    if (!activity) throw new Error('Agent activity not found.')
    if (!activity.detailArtifact) return { detail: activity.detail }
    return { detail: await artifactDetail(quickChat.id, quickChat.workspace, activity) }
  }

  async delete(userId: string, id: string) {
    const quickChat = await this.find(userId, id)
    const loggedActivities = await quickChatRunActivities(quickChat.agentRuns.map((run) => run.id))
    const activityGroups = [
      quickChat.agentActivities,
      loggedActivities,
      ...quickChat.agentRuns.map((run) => run.activities),
    ]
    await db.transaction(async (transaction) => {
      await this.fileAttachments.markOwnersDetached(
        'quickChatMessage',
        quickChat.messages.map((message) => message.id),
        transaction
      )
      quickChat.useTransaction(transaction)
      await quickChat.delete()
    })
    await deleteActivityArtifacts(quickChat.id, activityGroups)
  }

  private quickChatQuery(userId: string) {
    return QuickChat.query().whereIn(
      'projectId',
      Project.query().select('id').where('userId', userId)
    )
  }

  private async updateInput(quickChat: QuickChat, input: UpdateQuickChatInput) {
    const { agentActivity, agentActivityUpdates, ...update } = input
    const activities = await Promise.all(
      requestedActivities(agentActivity, agentActivityUpdates).map((activity) =>
        activityWithArtifact(quickChat.id, quickChat.clineSessionId, activity)
      )
    )
    if (!activities.length) return update
    return {
      ...update,
      agentActivities: activities.reduce(upsertActivity, quickChat.agentActivities ?? []),
    }
  }

  private agentRunQuery(quickChat: QuickChat, runId: string) {
    return QuickChatAgentRun.query()
      .where('quickChatId', quickChat.id)
      .where('id', runId)
      .firstOrFail()
  }

  private async messageForDelivery(id: string) {
    const message = await QuickChatMessage.query()
      .where('id', id)
      .preload('storedFileAttachments')
      .firstOrFail()
    await this.fileAttachments.prepareDownloads(storedAttachments(message))
    return message
  }

  private async prepareDownloads(quickChats: QuickChat[]) {
    const attachments = quickChats.flatMap((quickChat) =>
      quickChat.messages.flatMap(storedAttachments)
    )
    await this.fileAttachments.prepareDownloads(uniqueAttachments(attachments))
  }

  private async agentRunUpdateInput(
    quickChat: QuickChat,
    run: QuickChatAgentRun,
    input: UpdateQuickChatAgentRunInput
  ) {
    const { agentActivity, agentActivityUpdates, ...update } = input
    const nextUpdate = {
      ...update,
      ...agentRunCompletedAtUpdate(update),
    }
    const activities = await Promise.all(
      requestedActivities(agentActivity, agentActivityUpdates).map((activity) =>
        activityWithArtifact(quickChat.id, run.clineSessionId, activity, run.id)
      )
    )
    if (!activities.length) return nextUpdate
    await Promise.all(activities.map((activity) => persistQuickChatRunActivity(run.id, activity)))
    return {
      ...nextUpdate,
      activities: activities.reduce(upsertActivity, run.activities ?? []),
    }
  }
}

function assertQuickChatUndoTarget(quickChat: QuickChat, messageId: string, runId: string) {
  const message = quickChat.messages.find((item) => item.id === messageId)
  if (!message) throw new Error('Quick chat message not found.')
  const targetRun = quickChat.agentRuns.find((run) => run.id === runId)
  if (!targetRun || targetRun.messageId !== message.id) {
    throw new Exception('Agent run does not belong to this quick chat message.', {
      code: 'E_QUICK_CHAT_UNDO_RUN_MISMATCH',
      status: 409,
    })
  }
  return { message, targetRun }
}

function upsertActivity(activities: UserStoryAgentActivity[], input: UserStoryAgentActivity) {
  const exists = activities.some((activity) => activity.id === input.id)
  const next = exists
    ? activities.map((activity) => (activity.id === input.id ? input : activity))
    : [...activities, input]
  return next.slice(Math.max(0, next.length - maxAgentActivities))
}

function requestedActivities(
  activity: UserStoryAgentActivity | null | undefined,
  updates: UserStoryAgentActivity[] | undefined
) {
  return updates ?? (activity ? [activity] : [])
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

async function deleteQuickChatRuns(
  quickChatId: string,
  ids: string[],
  client?: Parameters<QuickChatAgentRun['useTransaction']>[0]
) {
  if (!ids.length) return
  await QuickChatAgentRun.query({ client })
    .where('quickChatId', quickChatId)
    .whereIn('id', ids)
    .delete()
}

async function deleteQuickChatMessages(
  quickChatId: string,
  ids: string[],
  client?: Parameters<QuickChatMessage['useTransaction']>[0]
) {
  if (!ids.length) return
  await QuickChatMessage.query({ client })
    .where('quickChatId', quickChatId)
    .whereIn('id', ids)
    .delete()
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

function storedAttachments(message: QuickChatMessage): FileAttachment[] {
  return (message.$preloaded.storedFileAttachments as FileAttachment[] | undefined) ?? []
}

function uniqueAttachments(attachments: FileAttachment[]) {
  return [...new Map(attachments.map((attachment) => [attachment.id, attachment])).values()]
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
