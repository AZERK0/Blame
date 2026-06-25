import type { UserStoryAgentActivity } from '#models/user_story'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

const maxPersistedDetailLength = 4096

export async function activityWithArtifact(
  workspace: string | null | undefined,
  sessionId: string | null | undefined,
  activity: UserStoryAgentActivity
): Promise<UserStoryAgentActivity> {
  if (!workspace || activity.detail.length <= maxPersistedDetailLength) return activity
  const artifact = await writeActivityArtifact(workspace, sessionId, activity)
  return {
    ...activity,
    detail: middleExcerpt(activity.detail, maxPersistedDetailLength),
    detailArtifact: artifact,
    detailTruncated: true,
    originalDetailLength: activity.detail.length,
  }
}

export async function artifactDetail(
  workspace: string | null | undefined,
  activity: UserStoryAgentActivity
) {
  const path = activity.detailArtifact
  if (!path || !workspace || !isAbsolute(path)) return activity.detail
  if (!isPathInside(resolve(path), resolve(workspace))) return activity.detail
  try {
    const artifact = JSON.parse(await readFile(path, 'utf8')) as UserStoryAgentActivity
    return typeof artifact.detail === 'string' ? artifact.detail : activity.detail
  } catch {
    return activity.detail
  }
}

async function writeActivityArtifact(
  workspace: string,
  sessionId: string | null | undefined,
  activity: UserStoryAgentActivity
) {
  const session = safeFilename(sessionId ?? 'unknown-session')
  const directory = join(workspace, '.blame', 'artifacts', 'agent-activities', session)
  await mkdir(directory, { recursive: true })
  const filename = `${safeFilename(activity.id)}.json`
  const path = join(directory, filename)
  await writeFile(path, JSON.stringify(activity, null, 2))
  return path
}

function middleExcerpt(value: string, length: number) {
  if (value.length <= length) return value
  const edgeLength = Math.floor((length - 20) / 2)
  return `${value.slice(0, edgeLength)}\n...\n${value.slice(-edgeLength)}`
}

function safeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 160)
}

function isPathInside(path: string, root: string) {
  return path === root || path.startsWith(`${root}/`)
}
