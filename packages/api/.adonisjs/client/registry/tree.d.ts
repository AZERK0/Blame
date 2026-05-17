/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
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
    accessTokens: {
      destroy: typeof routes['profile.access_tokens.destroy']
    }
  }
  projects: {
    projects: {
      index: typeof routes['projects.projects.index']
      store: typeof routes['projects.projects.store']
    }
    userStories: {
      userStories: {
        index: typeof routes['projects.user_stories.user_stories.index']
        store: typeof routes['projects.user_stories.user_stories.store']
        show: typeof routes['projects.user_stories.user_stories.show']
        update: typeof routes['projects.user_stories.user_stories.update']
        destroy: typeof routes['projects.user_stories.user_stories.destroy']
      }
    }
  }
}
