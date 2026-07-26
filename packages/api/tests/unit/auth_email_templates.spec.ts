import { EmailVerificationEmail } from '#mails/email_verification_email'
import { PasswordResetEmail } from '#mails/password_reset_email'
import { SignInCodeEmail } from '#mails/sign_in_code_email'
import { test } from '@japa/runner'
import { createElement, type ReactElement } from 'react'
import { render, toPlainText } from 'react-email'

const brand = {
  homeUrl: 'https://blame.so',
  logoUrl: 'https://blame.so/icons/blame-app-icon.png',
  recipientName: 'Ada Lovelace',
}

test.group('auth email templates', () => {
  test('renders the branded email verification action', async ({ assert }) => {
    const verificationUrl = 'https://api.blame.so/api/v1/auth/verify-email?token=verification'
    const email = createElement(EmailVerificationEmail, { ...brand, verificationUrl })
    const { html, text } = await renderedEmail(email)

    assert.include(html, 'background-color:#0a0a0a')
    assert.include(html, 'alt="Blame"')
    assert.notInclude(text, 'ACCOUNT VERIFICATION')
    assert.include(text, 'VERIFY YOUR EMAIL ADDRESS')
    assert.include(text, verificationUrl)
    assert.include(text, 'This link expires in 1 hour')
  })

  test('renders the password reset action', async ({ assert }) => {
    const resetUrl = 'https://blame.so/auth/reset-password?token=reset'
    const email = createElement(PasswordResetEmail, { ...brand, resetUrl })
    const { text } = await renderedEmail(email)

    assert.include(text, 'RESET YOUR PASSWORD')
    assert.notInclude(text, 'PASSWORD RESET')
    assert.include(text, resetUrl)
    assert.include(text, 'This link expires in 30 minutes')
  })

  test('renders the sign-in code without exposing an action link', async ({ assert }) => {
    const email = createElement(SignInCodeEmail, { ...brand, code: '047291' })
    const { text } = await renderedEmail(email)

    assert.include(text, '047291')
    assert.notInclude(text, 'SECURE SIGN-IN')
    assert.include(text, 'This code expires in 5 minutes')
    assert.notInclude(text, '/auth/')
  })
})

async function renderedEmail(email: ReactElement) {
  const html = await render(email)
  return { html, text: toPlainText(html) }
}
