import {
  AuthEmailLayout,
  type AuthEmailBrandProps,
  EmailAction,
  EmailNotice,
  EmailText,
} from '#mails/auth_email_layout'
import React from 'react'

type PasswordResetEmailProps = AuthEmailBrandProps & {
  resetUrl: string
}

export function PasswordResetEmail({
  homeUrl,
  logoUrl,
  recipientName,
  resetUrl,
}: PasswordResetEmailProps) {
  return (
    <AuthEmailLayout
      homeUrl={homeUrl}
      logoUrl={logoUrl}
      preview="Use this secure link to choose a new Blame password."
      title="Reset your password"
    >
      <EmailText>Hello {recipientName},</EmailText>
      <EmailText>
        We received a request to reset your Blame password. Choose a new password using the secure
        link below.
      </EmailText>
      <EmailAction href={resetUrl} label="Reset password" />
      <EmailNotice title="This link expires in 30 minutes">
        If you did not request a password reset, ignore this email. Your password will not change.
      </EmailNotice>
    </AuthEmailLayout>
  )
}

PasswordResetEmail.PreviewProps = {
  homeUrl: 'https://blame.so',
  logoUrl: 'https://blame.so/icons/blame-app-icon.png',
  recipientName: 'Ada Lovelace',
  resetUrl: 'https://blame.so/auth/reset-password?token=preview',
} satisfies PasswordResetEmailProps

export default PasswordResetEmail
