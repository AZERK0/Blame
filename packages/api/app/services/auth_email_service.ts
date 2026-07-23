import env from '#start/env'
import { Resend } from 'resend'

type AuthEmail = {
  subject: string
  text: string
  to: string
}

export async function sendAuthEmail(message: AuthEmail) {
  const apiKey = env.get('RESEND_API_KEY')?.release().trim()
  const from = env.get('AUTH_EMAIL_FROM')?.trim()
  if (!apiKey || !from) {
    if (env.get('NODE_ENV') === 'production') {
      throw new Error('Authentication email delivery is not configured')
    }
    return
  }

  void new Resend(apiKey).emails
    .send({ from, to: message.to, subject: message.subject, text: message.text })
    .catch(() => undefined)
}
