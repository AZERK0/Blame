import env from '#start/env'

export const speechTranscriptionFormats = [
  'aac',
  'flac',
  'm4a',
  'mp3',
  'mp4',
  'ogg',
  'wav',
  'webm',
] as const

export type SpeechTranscriptionFormat = (typeof speechTranscriptionFormats)[number]
export type SpeechTranscriptionConfig = ReturnType<typeof speechTranscriptionConfig>

export const speechTranscriptionMaxAudioBytes = 12_000_000
export const speechTranscriptionMaxEncodedChars = 16_000_000

export function speechTranscriptionConfig() {
  const requestsPerMinute = env.get('BLAME_SPEECH_TO_TEXT_REQUESTS_PER_MINUTE') ?? 20
  const maxConcurrentPerUser = env.get('BLAME_SPEECH_TO_TEXT_MAX_CONCURRENT') ?? 2

  if (!Number.isInteger(requestsPerMinute) || requestsPerMinute < 1) {
    throw new Error('BLAME_SPEECH_TO_TEXT_REQUESTS_PER_MINUTE must be positive')
  }
  if (!Number.isInteger(maxConcurrentPerUser) || maxConcurrentPerUser < 1) {
    throw new Error('BLAME_SPEECH_TO_TEXT_MAX_CONCURRENT must be positive')
  }

  return {
    apiKey: env.get('OPENROUTER_API_KEY')?.release().trim() ?? '',
    maxConcurrentPerUser,
    model: env.get('BLAME_SPEECH_TO_TEXT_MODEL') ?? 'openai/gpt-transcribe',
    requestsPerMinute,
    timeoutMs: env.get('BLAME_SPEECH_TO_TEXT_TIMEOUT_MS') ?? 60_000,
  }
}
