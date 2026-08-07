import vine from '@vinejs/vine'
import {
  speechTranscriptionFormats,
  speechTranscriptionMaxEncodedChars,
} from '#config/speech_transcription'

export const transcribeSpeechValidator = vine.create({
  data: vine
    .string()
    .trim()
    .minLength(4)
    .maxLength(speechTranscriptionMaxEncodedChars)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  format: vine.enum(speechTranscriptionFormats),
})
