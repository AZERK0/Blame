/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import { middleware } from '#start/kernel'
import router from '@adonisjs/core/services/router'
import { controllers } from '#generated/controllers'

const ProviderCredentialsController = () => import('#controllers/provider_credentials_controller')
const ProjectCodePracticesController = () =>
  import('#controllers/project_code_practices_controller')
const ProjectCodePracticeAnalysesController = () =>
  import('#controllers/project_code_practice_analyses_controller')
const ProjectInitializationsController = () =>
  import('#controllers/project_initializations_controller')
const QuickChatAgentRunsController = () => import('#controllers/quick_chat_agent_runs_controller')
const QuickChatMessagesController = () => import('#controllers/quick_chat_messages_controller')
const QuickChatsController = () => import('#controllers/quick_chats_controller')
const UserAiPreferencesController = () => import('#controllers/user_ai_preferences_controller')
const UserMcpConfigurationsController = () =>
  import('#controllers/user_mcp_configurations_controller')
const UserStoryAgentRunsController = () => import('#controllers/user_story_agent_runs_controller')
const UserStoryCommentsController = () => import('#controllers/user_story_comments_controller')
const BillingController = () => import('#controllers/billing_controller')
const StripeWebhooksController = () => import('#controllers/stripe_webhooks_controller')
const AccountPrivacyController = () => import('#controllers/account_privacy_controller')
const TelemetryIngestionController = () => import('#controllers/telemetry_ingestion_controller')
const TelemetrySessionsController = () => import('#controllers/telemetry_sessions_controller')
const ConsumerContractsController = () => import('#controllers/consumer_contracts_controller')
const BetterAuthController = () => import('#controllers/better_auth_controller')
const DesktopAuthController = () => import('#controllers/desktop_auth_controller')

router.get('/', () => {
  return { hello: 'world' }
})

router
  .group(() => {
    router.post('webhooks/stripe', [StripeWebhooksController, 'handle'])
    router.post('account/closure-status', [AccountPrivacyController, 'status'])
    router.post('consumer-contract/withdrawal', [ConsumerContractsController, 'withdraw'])
    router.post('telemetry/otlp/v1/:signal', [TelemetryIngestionController, 'store'])

    router.get('telemetry/session', [TelemetrySessionsController, 'show']).use(middleware.auth())

    router
      .group(() => {
        router.get('/', [BillingController, 'show'])
        router.post('/checkout', [BillingController, 'checkout'])
        router.post('/portal', [BillingController, 'portal'])
      })
      .prefix('billing')
      .as('billing')
      .use(middleware.auth())

    router.get('auth/desktop-complete', [DesktopAuthController, 'complete'])
    router.get('auth/desktop', [DesktopAuthController, 'passkey'])
    router.get('auth/reset-password-page', [DesktopAuthController, 'resetPassword'])
    router.get('auth/verified', [DesktopAuthController, 'verified'])
    router.post('auth/desktop-exchange', [DesktopAuthController, 'exchange'])
    router.post('auth/desktop-device-exchange', [DesktopAuthController, 'exchangeDeviceToken'])
    router.any('auth/*', [BetterAuthController, 'handle']).as('auth.better')

    router
      .group(() => {
        router.get('profile', [controllers.Profile, 'show'])
        router.get('ai-preferences', [UserAiPreferencesController, 'show'])
        router.put('ai-preferences', [UserAiPreferencesController, 'update'])
        router.get('mcp-configurations', [UserMcpConfigurationsController, 'show'])
        router.put('mcp-configurations', [UserMcpConfigurationsController, 'update'])
        router.post('export', [AccountPrivacyController, 'download'])
        router.post('closure', [AccountPrivacyController, 'close'])
        router.post('logout', [controllers.AccessTokens, 'destroy'])
      })
      .prefix('account')
      .as('profile')
      .use(middleware.auth())

    router
      .group(() => {
        router.get('/', [controllers.Projects, 'index'])
        router.post('/', [controllers.Projects, 'store'])
        router.get('/:projectId/code-practices', [ProjectCodePracticesController, 'index'])
        router.patch('/:projectId/code-practices/:practice', [
          ProjectCodePracticesController,
          'update',
        ])
        router.get('/:projectId/code-practice-analysis', [
          ProjectCodePracticeAnalysesController,
          'show',
        ])
        router.post('/:projectId/code-practice-analysis/start', [
          ProjectCodePracticeAnalysesController,
          'start',
        ])
        router.post('/:projectId/code-practice-analysis/complete', [
          ProjectCodePracticeAnalysesController,
          'complete',
        ])
        router.post('/:projectId/code-practice-analysis/fail', [
          ProjectCodePracticeAnalysesController,
          'fail',
        ])
        router.post('/:projectId/code-practice-analysis/viewed', [
          ProjectCodePracticeAnalysesController,
          'viewed',
        ])
        router.get('/:projectId/initialization', [ProjectInitializationsController, 'show'])
        router.post('/:projectId/initialization/start', [ProjectInitializationsController, 'start'])
        router.post('/:projectId/initialization/complete', [
          ProjectInitializationsController,
          'complete',
        ])
        router.post('/:projectId/initialization/fail', [ProjectInitializationsController, 'fail'])
        router.post('/:projectId/initialization/repair', [
          ProjectInitializationsController,
          'repair',
        ])
      })
      .prefix('projects')
      .as('projects')
      .use([middleware.auth(), middleware.license()])

    router
      .group(() => {
        router.get('catalog', [ProviderCredentialsController, 'catalog'])
        router.get('credentials', [ProviderCredentialsController, 'index'])
        router.post('credentials', [ProviderCredentialsController, 'store'])
        router.post('credentials/oauth', [ProviderCredentialsController, 'storeOAuth'])
        router.post('credentials/resolve', [ProviderCredentialsController, 'resolve'])
        router.delete('credentials/:id', [ProviderCredentialsController, 'destroy'])
      })
      .prefix('providers')
      .as('providers')
      .use([middleware.auth(), middleware.license()])

    router
      .group(() => {
        router.get('/', [QuickChatsController, 'index'])
        router.post('/', [QuickChatsController, 'store'])
        router.get('/:id', [QuickChatsController, 'show'])
        router.patch('/:id', [QuickChatsController, 'update'])
        router.delete('/:id', [QuickChatsController, 'destroy'])
        router.post('/:id/messages', [QuickChatMessagesController, 'store'])
        router.post('/:id/messages/:messageId/undo', [QuickChatMessagesController, 'undo'])
        router.post('/:id/messages/:messageId/undo-validation', [
          QuickChatMessagesController,
          'validateUndo',
        ])
        router.post('/:id/agent-runs', [QuickChatAgentRunsController, 'store'])
        router.patch('/:id/agent-runs/:runId', [QuickChatAgentRunsController, 'update'])
        router.get('/:id/agent-runs/:runId/activities/:activityId', [
          QuickChatAgentRunsController,
          'activityDetail',
        ])
      })
      .prefix('projects/quick-chats')
      .as('projects.quick_chats')
      .use([middleware.auth(), middleware.license()])

    router
      .group(() => {
        router.get('/', [controllers.UserStories, 'index'])
        router.post('/', [controllers.UserStories, 'store'])
        router.get('/:id', [controllers.UserStories, 'show'])
        router.patch('/:id', [controllers.UserStories, 'update'])
        router.delete('/:id', [controllers.UserStories, 'destroy'])
        router.get('/:id/agent-activities/:activityId', [controllers.UserStories, 'activityDetail'])
        router.post('/:id/agent-runs', [UserStoryAgentRunsController, 'store'])
        router.patch('/:id/agent-runs/:runId', [UserStoryAgentRunsController, 'update'])
        router.get('/:id/agent-runs/:runId/activities/:activityId', [
          UserStoryAgentRunsController,
          'activityDetail',
        ])
        router.post('/:id/comments', [UserStoryCommentsController, 'store'])
        router.post('/:id/comments/:commentId/undo', [UserStoryCommentsController, 'undo'])
        router.post('/:id/comments/:commentId/undo-validation', [
          UserStoryCommentsController,
          'validateUndo',
        ])
      })
      .prefix('projects/user-stories')
      .as('projects.user_stories')
      .use([middleware.auth(), middleware.license()])
  })
  .prefix('/api/v1')
