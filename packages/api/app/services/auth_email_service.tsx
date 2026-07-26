import { sitePageUrl, siteUrl } from '#lib/site_url'
import { EmailVerificationEmail } from '#mails/email_verification_email'
import { PasswordResetEmail } from '#mails/password_reset_email'
import { SignInCodeEmail } from '#mails/sign_in_code_email'
import env from '#start/env'
import React, { type ReactElement } from 'react'
import { render, toPlainText } from 'react-email'
import { Resend } from 'resend'

type AuthEmail = {
  content: ReactElement
  subject: string
  to: string
}

type AuthEmailRecipient = {
  name: string
  to: string
}

export function sendEmailVerificationEmail({
  name,
  to,
  verificationUrl,
}: AuthEmailRecipient & { verificationUrl: string }) {
  return sendAuthEmail({
    to,
    subject: 'Verify your email address | Blame',
    content: <EmailVerificationEmail {...emailBrand(name)} verificationUrl={verificationUrl} />,
  })
}

export function sendPasswordResetEmail({
  name,
  resetUrl,
  to,
}: AuthEmailRecipient & { resetUrl: string }) {
  return sendAuthEmail({
    to,
    subject: 'Reset your password | Blame',
    content: <PasswordResetEmail {...emailBrand(name)} resetUrl={resetUrl} />,
  })
}

export function sendSignInCodeEmail({ code, name, to }: AuthEmailRecipient & { code: string }) {
  return sendAuthEmail({
    to,
    subject: 'Your sign-in code | Blame',
    content: <SignInCodeEmail {...emailBrand(name)} code={code} />,
  })
}

async function sendAuthEmail(message: AuthEmail) {
  const delivery = emailDelivery()
  if (!delivery) return
  const html = await render(message.content)
  const { error } = await delivery.resend.emails.send({
    from: delivery.from,
    html,
    subject: message.subject,
    text: toPlainText(html),
    to: message.to,
  })
  if (error) {
    throw new Error(`Authentication email delivery failed: ${error.message}`)
  }
}

function emailDelivery() {
  const apiKey = env.get('RESEND_API_KEY')?.release().trim()
  const from = env.get('AUTH_EMAIL_FROM')?.trim()
  if (apiKey && from) return { from, resend: new Resend(apiKey) }
  if (env.get('NODE_ENV') === 'production') {
    throw new Error('Authentication email delivery is not configured')
  }
  return null
}

function emailBrand(recipientName: string) {
  return {
    homeUrl: siteUrl,
    logoUrl: sitePageUrl('/icons/blame-app-icon.png'),
    recipientName,
  }
}
