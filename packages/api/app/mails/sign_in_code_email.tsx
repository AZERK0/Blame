import {
  AuthEmailLayout,
  type AuthEmailBrandProps,
  EmailCode,
  EmailNotice,
  EmailText,
} from '#mails/auth_email_layout'
import React from 'react'

type SignInCodeEmailProps = AuthEmailBrandProps & {
  code: string
}

export function SignInCodeEmail({ code, homeUrl, logoUrl, recipientName }: SignInCodeEmailProps) {
  return (
    <AuthEmailLayout
      homeUrl={homeUrl}
      logoUrl={logoUrl}
      preview="Your one-time Blame sign-in code is ready."
      title="Your sign-in code"
    >
      <EmailText>Hello {recipientName},</EmailText>
      <EmailText>Enter this six-digit code in Blame to finish signing in:</EmailText>
      <EmailCode value={code} />
      <EmailNotice title="This code expires in 5 minutes">
        Never share this code with anyone. Blame will never ask you for it outside the sign-in
        screen.
      </EmailNotice>
    </AuthEmailLayout>
  )
}

SignInCodeEmail.PreviewProps = {
  code: '047291',
  homeUrl: 'https://blame.so',
  logoUrl: 'https://blame.so/icons/blame-app-icon.png',
  recipientName: 'Ada Lovelace',
} satisfies SignInCodeEmailProps

export default SignInCodeEmail
