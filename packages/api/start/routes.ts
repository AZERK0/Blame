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

router.get('/', () => {
  return { hello: 'world' }
})

router
  .group(() => {
    router.post('webhooks/stripe', [StripeWebhooksController, 'handle'])

    router
      .group(() => {
        router.get('/', [BillingController, 'show'])
        router.post('/checkout', [BillingController, 'checkout'])
        router.post('/portal', [BillingController, 'portal'])
      })
      .prefix('billing')
      .as('billing')
      .use(middleware.auth())

    router
      .group(() => {
        router.post('signup', [controllers.NewAccount, 'store'])
        router.post('login', [controllers.AccessTokens, 'store'])
      })
      .prefix('auth')
      .as('auth')

    router
      .group(() => {
        router.get('profile', [controllers.Profile, 'show'])
        router.get('ai-preferences', [UserAiPreferencesController, 'show'])
        router.put('ai-preferences', [UserAiPreferencesController, 'update'])
        router.get('mcp-configurations', [UserMcpConfigurationsController, 'show'])
        router.put('mcp-configurations', [UserMcpConfigurationsController, 'update'])
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
      })
      .prefix('projects/user-stories')
      .as('projects.user_stories')
      .use([middleware.auth(), middleware.license()])
  })
  .prefix('/api/v1')
