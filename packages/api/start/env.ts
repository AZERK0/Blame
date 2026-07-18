/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| The `Env.create` method creates an instance of the Env service. The
| service validates the environment variables and also cast values
| to JavaScript data types.
|
*/

import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  // Node
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.string(),

  // App
  APP_KEY: Env.schema.secret(),
  APP_KEY_PREVIOUS: Env.schema.secret.optional(),
  APP_URL: Env.schema.string({ format: 'url', tld: false }),
  CORS_ORIGIN: Env.schema.string.optional(),
  ACCOUNT_CLOSURE_LEDGER_DIRECTORY: Env.schema.string.optional(),
  BLAME_TELEMETRY_MAX_PAYLOAD_BYTES: Env.schema.number.optional(),
  BLAME_TELEMETRY_PUBLIC_ENDPOINT: Env.schema.string({ format: 'url', tld: false }),
  BLAME_TELEMETRY_REQUESTS_PER_MINUTE: Env.schema.number.optional(),
  BLAME_TELEMETRY_TOKEN_SECRET: Env.schema.secret(),
  BLAME_TELEMETRY_TOKEN_TTL_SECONDS: Env.schema.number.optional(),
  BLAME_TELEMETRY_UPSTREAM_ENDPOINT: Env.schema.string({ format: 'url', tld: false }),
  BLAME_TELEMETRY_UPSTREAM_HEADERS: Env.schema.secret.optional(),
  BLAME_TELEMETRY_UPSTREAM_TIMEOUT_MS: Env.schema.number.optional(),

  DB_HOST: Env.schema.string({ format: 'host' }),
  DB_PORT: Env.schema.number(),
  DB_USER: Env.schema.string(),
  DB_PASSWORD: Env.schema.string.optional(),
  DB_DATABASE: Env.schema.string(),

  // Session
  SESSION_DRIVER: Env.schema.enum(['cookie', 'memory', 'database'] as const),

  // Stripe Billing
  STRIPE_SECRET_KEY: Env.schema.string.optional(),
  STRIPE_WEBHOOK_SECRET: Env.schema.string.optional(),
  STRIPE_MONTHLY_PRICE_ID: Env.schema.string.optional(),
  STRIPE_YEARLY_PRICE_ID: Env.schema.string.optional(),
  STRIPE_CHECKOUT_SUCCESS_URL: Env.schema.string.optional({ format: 'url', tld: false }),
  STRIPE_CHECKOUT_CANCEL_URL: Env.schema.string.optional({ format: 'url', tld: false }),
  STRIPE_PORTAL_RETURN_URL: Env.schema.string.optional({ format: 'url', tld: false }),
})
