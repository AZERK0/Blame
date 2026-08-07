import {
  speechTranscriptionConfig,
  speechTranscriptionMaxAudioBytes,
  type SpeechTranscriptionFormat,
  type SpeechTranscriptionConfig,
} from '#config/speech_transcription'

type SpeechTranscriptionInput = {
  data: string
  format: SpeechTranscriptionFormat
}

export class SpeechTranscriptionError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'SpeechTranscriptionError'
  }
}

export default class SpeechTranscriptionService {
  constructor(
    private readonly config: SpeechTranscriptionConfig = speechTranscriptionConfig(),
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async transcribe(input: SpeechTranscriptionInput) {
    if (!this.config.apiKey) {
      throw new SpeechTranscriptionError('Speech transcription is not configured.', 503)
    }

    const audio = decodeAudio(input.data)
    if (audio.byteLength > speechTranscriptionMaxAudioBytes) {
      throw new SpeechTranscriptionError('Audio recording is too large.', 413)
    }

    let response: Response
    try {
      response = await this.fetcher('https://openrouter.ai/api/v1/audio/transcriptions', {
        body: JSON.stringify({
          input_audio: { data: input.data, format: input.format },
          model: this.config.model,
          temperature: 0,
        }),
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': envSiteUrl(),
          'X-OpenRouter-Title': 'Blame',
        },
        signal: AbortSignal.timeout(this.config.timeoutMs),
      })
    } catch {
      throw new SpeechTranscriptionError('Speech transcription is temporarily unavailable.', 503)
    }

    const body = await response.json().catch(() => null)
    if (!response.ok) {
      throw new SpeechTranscriptionError(
        response.status === 429
          ? 'Speech transcription is temporarily busy.'
          : 'Speech transcription is temporarily unavailable.',
        response.status === 429 ? 503 : 502
      )
    }

    const text = transcriptionText(body)
    if (text === undefined) {
      throw new SpeechTranscriptionError('Speech transcription returned an invalid response.', 502)
    }
    return { text }
  }
}

function decodeAudio(data: string) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
    throw new SpeechTranscriptionError('Audio recording is invalid.', 422)
  }
  const audio = Buffer.from(data, 'base64')
  if (audio.byteLength === 0) throw new SpeechTranscriptionError('Audio recording is empty.', 422)
  return audio
}

function transcriptionText(value: unknown) {
  if (!value || typeof value !== 'object' || !('text' in value)) return undefined
  const text = value.text
  return typeof text === 'string' ? text.trim() : undefined
}

function envSiteUrl() {
  return process.env.BLAME_SITE_URL ?? 'https://blame.dev'
}
