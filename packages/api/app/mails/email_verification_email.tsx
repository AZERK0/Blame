import {
  AuthEmailLayout,
  type AuthEmailBrandProps,
  EmailAction,
  EmailNotice,
  EmailText,
} from '#mails/auth_email_layout'
import React from 'react'

type EmailVerificationEmailProps = AuthEmailBrandProps & {
  verificationUrl: string
}

export function EmailVerificationEmail({
  homeUrl,
  logoUrl,
  recipientName,
  verificationUrl,
}: EmailVerificationEmailProps) {
  return (
    <AuthEmailLayout
      homeUrl={homeUrl}
      logoUrl={logoUrl}
      preview="Confirm your email address to finish setting up Blame."
      title="Verify your email address"
    >
      <EmailText>Hello {recipientName},</EmailText>
      <EmailText>
        Welcome to Blame. Confirm that this email address belongs to you to secure your account and
        continue to the app.
      </EmailText>
      <EmailAction href={verificationUrl} label="Verify email address" />
      <EmailNotice title="This link expires in 1 hour">
        If you did not create a Blame account, you can safely ignore this email.
      </EmailNotice>
    </AuthEmailLayout>
  )
}

EmailVerificationEmail.PreviewProps = {
  homeUrl: 'https://blame.so',
  logoUrl: 'https://blame.so/icons/blame-app-icon.png',
  recipientName: 'Ada Lovelace',
  verificationUrl: 'https://api.blame.so/api/v1/auth/verify-email?token=preview',
} satisfies EmailVerificationEmailProps

export default EmailVerificationEmail
