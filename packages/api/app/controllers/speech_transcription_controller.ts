import SpeechTranscriptionRateLimiter from '#services/speech_transcription_rate_limiter'
import SpeechTranscriptionService, {
  SpeechTranscriptionError,
} from '#services/speech_transcription_service'
import { speechTranscriptionConfig } from '#config/speech_transcription'
import { transcribeSpeechValidator } from '#validators/speech_transcription'
import type { HttpContext } from '@adonisjs/core/http'

const config = speechTranscriptionConfig()
const rateLimiter = new SpeechTranscriptionRateLimiter(
  config.requestsPerMinute,
  config.maxConcurrentPerUser
)

export default class SpeechTranscriptionController {
  async store({ auth, request, response }: HttpContext) {
    const reservation = rateLimiter.acquire(auth.getUserOrFail().id)
    if (!reservation) {
      response.header('Retry-After', '60')
      return response.tooManyRequests({
        message: 'Speech transcription rate limit reached. Please try again shortly.',
      })
    }

    try {
      const input = await request.validateUsing(transcribeSpeechValidator)
      return await new SpeechTranscriptionService().transcribe(input)
    } catch (error) {
      if (error instanceof SpeechTranscriptionError) {
        return response.status(error.status).send({ message: error.message })
      }
      throw error
    } finally {
      rateLimiter.release(reservation)
    }
  }
}
