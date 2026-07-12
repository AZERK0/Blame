/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
  stripeWebhooks: typeof routes['stripe_webhooks']
  billing: {
    billing: {
      show: typeof routes['billing.billing.show']
      checkout: typeof routes['billing.billing.checkout']
      portal: typeof routes['billing.billing.portal']
    }
  }
  auth: {
    newAccount: {
      store: typeof routes['auth.new_account.store']
    }
    accessTokens: {
      store: typeof routes['auth.access_tokens.store']
    }
  }
  profile: {
    profile: {
      show: typeof routes['profile.profile.show']
    }
    userAiPreferences: {
      show: typeof routes['profile.user_ai_preferences.show']
      update: typeof routes['profile.user_ai_preferences.update']
    }
    userMcpConfigurations: {
      show: typeof routes['profile.user_mcp_configurations.show']
      update: typeof routes['profile.user_mcp_configurations.update']
    }
    accessTokens: {
      destroy: typeof routes['profile.access_tokens.destroy']
    }
  }
  projects: {
    projects: {
      index: typeof routes['projects.projects.index']
      store: typeof routes['projects.projects.store']
    }
    projectCodePractices: {
      index: typeof routes['projects.project_code_practices.index']
      update: typeof routes['projects.project_code_practices.update']
    }
    projectInitializations: {
      show: typeof routes['projects.project_initializations.show']
      start: typeof routes['projects.project_initializations.start']
      complete: typeof routes['projects.project_initializations.complete']
      fail: typeof routes['projects.project_initializations.fail']
      repair: typeof routes['projects.project_initializations.repair']
    }
    quickChats: {
      quickChats: {
        index: typeof routes['projects.quick_chats.quick_chats.index']
        store: typeof routes['projects.quick_chats.quick_chats.store']
        show: typeof routes['projects.quick_chats.quick_chats.show']
        update: typeof routes['projects.quick_chats.quick_chats.update']
        destroy: typeof routes['projects.quick_chats.quick_chats.destroy']
      }
      quickChatMessages: {
        store: typeof routes['projects.quick_chats.quick_chat_messages.store']
        undo: typeof routes['projects.quick_chats.quick_chat_messages.undo']
      }
      quickChatAgentRuns: {
        store: typeof routes['projects.quick_chats.quick_chat_agent_runs.store']
        update: typeof routes['projects.quick_chats.quick_chat_agent_runs.update']
        activityDetail: typeof routes['projects.quick_chats.quick_chat_agent_runs.activity_detail']
      }
    }
    userStories: {
      userStories: {
        index: typeof routes['projects.user_stories.user_stories.index']
        store: typeof routes['projects.user_stories.user_stories.store']
        show: typeof routes['projects.user_stories.user_stories.show']
        update: typeof routes['projects.user_stories.user_stories.update']
        destroy: typeof routes['projects.user_stories.user_stories.destroy']
        activityDetail: typeof routes['projects.user_stories.user_stories.activity_detail']
      }
      userStoryAgentRuns: {
        store: typeof routes['projects.user_stories.user_story_agent_runs.store']
        update: typeof routes['projects.user_stories.user_story_agent_runs.update']
        activityDetail: typeof routes['projects.user_stories.user_story_agent_runs.activity_detail']
      }
      userStoryComments: {
        store: typeof routes['projects.user_stories.user_story_comments.store']
        undo: typeof routes['projects.user_stories.user_story_comments.undo']
      }
    }
  }
  providers: {
    providerCredentials: {
      catalog: typeof routes['providers.provider_credentials.catalog']
      index: typeof routes['providers.provider_credentials.index']
      store: typeof routes['providers.provider_credentials.store']
      storeOAuth: typeof routes['providers.provider_credentials.store_o_auth']
      resolve: typeof routes['providers.provider_credentials.resolve']
      destroy: typeof routes['providers.provider_credentials.destroy']
    }
  }
}
