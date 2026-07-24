import { uuidV7 } from '#lib/uuid_v7'
import { sendAuthEmail } from '#services/auth_email_service'
import env from '#start/env'
import hash from '@adonisjs/core/services/hash'
import { passkey } from '@better-auth/passkey'
import db from '@adonisjs/lucid/services/db'
import { betterAuth } from 'better-auth'
import { bearer, twoFactor } from 'better-auth/plugins'
import { createPool } from 'mysql2/promise'
import { randomBytes } from 'node:crypto'

const baseURL = env.get('BETTER_AUTH_URL', env.get('APP_URL')).replace(/\/$/, '')
const betterAuthSecret = env.get('BETTER_AUTH_SECRET')?.release() ?? env.get('APP_KEY').release()
const socialProviders = configuredSocialProviders()

export const auth = betterAuth({
  appName: 'Blame',
  baseURL,
  basePath: '/api/v1/auth',
  secret: betterAuthSecret,
  database: createPool({
    host: env.get('DB_HOST'),
    port: env.get('DB_PORT'),
    user: env.get('DB_USER'),
    password: env.get('DB_PASSWORD'),
    database: env.get('DB_DATABASE'),
    timezone: 'Z',
    connectionLimit: 10,
  }),
  advanced: {
    database: { generateId: () => uuidV7() },
    useSecureCookies: baseURL.startsWith('https://'),
    cookies: {
      two_factor: {
        attributes: baseURL.startsWith('https://')
          ? { sameSite: 'none', secure: true }
          : { sameSite: 'lax' },
      },
    },
  },
  trustedOrigins: trustedOrigins(),
  user: {
    modelName: 'users',
    fields: {
      name: 'full_name',
      emailVerified: 'email_verified',
      image: 'image',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  session: {
    modelName: 'auth_sessions',
    fields: {
      expiresAt: 'expires_at',
      token: 'token',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
      userId: 'user_id',
    },
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  account: {
    modelName: 'auth_accounts',
    fields: {
      accountId: 'account_id',
      providerId: 'provider_id',
      userId: 'user_id',
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
      idToken: 'id_token',
      accessTokenExpiresAt: 'access_token_expires_at',
      refreshTokenExpiresAt: 'refresh_token_expires_at',
      scope: 'scope',
      password: 'password',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    accountLinking: {
      trustedProviders: ['google', 'github'],
      allowDifferentEmails: false,
      allowUnlinkingAll: false,
      requireLocalEmailVerified: true,
    },
  },
  verification: {
    modelName: 'auth_verifications',
    fields: {
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    requireEmailVerification: true,
    autoSignIn: false,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 30,
    password: {
      hash: (password) => hash.make(password),
      verify: ({ hash: passwordHash, password }) => hash.verify(passwordHash, password),
    },
    sendResetPassword: async ({ user, url }) => {
      await sendAuthEmail({
        to: user.email,
        subject: 'Reset your Blame password',
        text: `Reset your password using this secure link (valid for 30 minutes): ${url}`,
      })
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: false,
    expiresIn: 60 * 60,
    sendVerificationEmail: async ({ user, url }) => {
      await sendAuthEmail({
        to: user.email,
        subject: 'Verify your Blame email address',
        text: `Verify your email address using this secure link (valid for one hour): ${url}`,
      })
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({ data: { ...user, twoFactorEnabled: true } }),
        after: async (user) => createEmailTwoFactor(user.id),
      },
    },
  },
  socialProviders,
  plugins: [
    bearer({ requireSignature: true }),
    twoFactor({
      twoFactorTable: 'auth_two_factors',
      totpOptions: { disable: true },
      backupCodeOptions: { storeBackupCodes: 'plain' },
      otpOptions: {
        period: 5,
        digits: 6,
        allowedAttempts: 5,
        storeOTP: 'hashed',
        sendOTP: async ({ user, otp }) => {
          await sendAuthEmail({
            to: user.email,
            subject: 'Your Blame sign-in code',
            text: `Your Blame sign-in code is ${otp}. It expires in 5 minutes.`,
          })
        },
      },
      schema: {
        user: { fields: { twoFactorEnabled: 'two_factor_enabled' } },
        twoFactor: {
          fields: {
            backupCodes: 'backup_codes',
            userId: 'user_id',
            failedVerificationCount: 'failed_verification_count',
            lockedUntil: 'locked_until',
          },
        },
      },
    }),
    passkey({
      rpName: 'Blame',
      rpID: new URL(baseURL).hostname,
      origin: new URL(baseURL).origin,
      authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' },
    }),
  ],
  rateLimit: {
    enabled: true,
    window: 60,
    max: 20,
  },
  telemetry: { enabled: false },
})

function trustedOrigins() {
  return env
    .get('BETTER_AUTH_TRUSTED_ORIGINS', new URL(baseURL).origin)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

function configuredSocialProviders() {
  const github = providerCredentials('GITHUB')
  const google = providerCredentials('GOOGLE')
  const microsoft = providerCredentials('MICROSOFT')
  return {
    ...(github ? { github } : {}),
    ...(google ? { google } : {}),
    ...(microsoft
      ? {
          microsoft: {
            ...microsoft,
            tenantId: env.get('MICROSOFT_TENANT_ID', 'common'),
            prompt: 'select_account' as const,
          },
        }
      : {}),
  }
}

function providerCredentials(prefix: 'GITHUB' | 'GOOGLE' | 'MICROSOFT') {
  const clientId = env.get(`${prefix}_CLIENT_ID`)?.trim()
  const clientSecret = env.get(`${prefix}_CLIENT_SECRET`)?.release().trim()
  return clientId && clientSecret ? { clientId, clientSecret } : undefined
}

async function createEmailTwoFactor(userId: string) {
  await db.table('auth_two_factors').insert({
    id: uuidV7(),
    secret: randomBytes(32).toString('base64url'),
    backup_codes: '[]',
    user_id: userId,
    verified: true,
    failed_verification_count: 0,
  })
}
