import QuickChatAgentRunActivity from '#models/quick_chat_agent_run_activity'
import type { UserStoryAgentActivity } from '#models/user_story'
import UserStoryAgentRunActivity from '#models/user_story_agent_run_activity'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

export async function persistUserStoryRunActivity(
  runId: string,
  activity: UserStoryAgentActivity,
  client?: TransactionClientContract
) {
  const existing = await UserStoryAgentRunActivity.query({ client })
    .where('runId', runId)
    .where('activityId', activity.id)
    .first()
  if (!existing) {
    return UserStoryAgentRunActivity.create(
      { runId, activityId: activity.id, activity },
      { client }
    )
  }
  existing.activity = activityWithDurableDetail(existing.activity, activity)
  return existing.save()
}

export async function persistQuickChatRunActivity(
  runId: string,
  activity: UserStoryAgentActivity,
  client?: TransactionClientContract
) {
  const existing = await QuickChatAgentRunActivity.query({ client })
    .where('runId', runId)
    .where('activityId', activity.id)
    .first()
  if (!existing) {
    return QuickChatAgentRunActivity.create(
      { runId, activityId: activity.id, activity },
      { client }
    )
  }
  existing.activity = activityWithDurableDetail(existing.activity, activity)
  return existing.save()
}

export async function userStoryRunActivity(runId: string, activityId: string) {
  const record = await UserStoryAgentRunActivity.query()
    .where('runId', runId)
    .where('activityId', activityId)
    .first()
  return record?.activity ?? undefined
}

export async function quickChatRunActivity(runId: string, activityId: string) {
  const record = await QuickChatAgentRunActivity.query()
    .where('runId', runId)
    .where('activityId', activityId)
    .first()
  return record?.activity ?? undefined
}

export async function userStoryRunActivities(runIds: string[]) {
  if (!runIds.length) return []
  const records = await UserStoryAgentRunActivity.query().whereIn('runId', runIds)
  return records.flatMap((record) => (record.activity ? [record.activity] : []))
}

export async function quickChatRunActivities(runIds: string[]) {
  if (!runIds.length) return []
  const records = await QuickChatAgentRunActivity.query().whereIn('runId', runIds)
  return records.flatMap((record) => (record.activity ? [record.activity] : []))
}

function activityWithDurableDetail(
  existing: UserStoryAgentActivity | null,
  input: UserStoryAgentActivity
) {
  if (!existing?.detailArtifact || input.detailArtifact) return input
  return {
    ...input,
    detail: existing.detail,
    detailArtifact: existing.detailArtifact,
    detailTruncated: existing.detailTruncated,
    originalDetailLength: existing.originalDetailLength,
  }
}
