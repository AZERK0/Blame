/* eslint-disable prettier/prettier */
/// <reference path="../manifest.d.ts" />

import type { ExtractBody, ExtractErrorResponse, ExtractQuery, ExtractQueryForGet, ExtractResponse } from '@tuyau/core/types'
import type { InferInput, SimpleError } from '@vinejs/vine/types'

export type ParamValue = string | number | bigint | boolean

export interface Registry {
  'auth.new_account.store': {
    methods: ["POST"]
    pattern: '/api/v1/auth/signup'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').signupValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').signupValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/new_account_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/new_account_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'auth.access_tokens.store': {
    methods: ["POST"]
    pattern: '/api/v1/auth/login'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').loginValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').loginValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/access_tokens_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/access_tokens_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'profile.profile.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/account/profile'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/profile_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/profile_controller').default['show']>>>
    }
  }
  'profile.access_tokens.destroy': {
    methods: ["POST"]
    pattern: '/api/v1/account/logout'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/access_tokens_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/access_tokens_controller').default['destroy']>>>
    }
  }
  'projects.projects.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/projects'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/projects_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/projects_controller').default['index']>>>
    }
  }
  'projects.projects.store': {
    methods: ["POST"]
    pattern: '/api/v1/projects'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/project').ensureProjectValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/project').ensureProjectValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/projects_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/projects_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'projects.project_code_practices.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/projects/:projectId/code-practices'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { projectId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/project_code_practices_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/project_code_practices_controller').default['index']>>>
    }
  }
  'projects.project_code_practices.update': {
    methods: ["PATCH"]
    pattern: '/api/v1/projects/:projectId/code-practices/:practice'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/project_code_practice').updateProjectCodePracticeValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { projectId: ParamValue; practice: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/project_code_practice').updateProjectCodePracticeValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/project_code_practices_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/project_code_practices_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'projects.project_initializations.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/projects/:projectId/initialization'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { projectId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/project_initializations_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/project_initializations_controller').default['show']>>>
    }
  }
  'projects.project_initializations.start': {
    methods: ["POST"]
    pattern: '/api/v1/projects/:projectId/initialization/start'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/project_initialization').startProjectInitializationValidator)>>
      paramsTuple: [ParamValue]
      params: { projectId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/project_initialization').startProjectInitializationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/project_initializations_controller').default['start']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/project_initializations_controller').default['start']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'projects.project_initializations.complete': {
    methods: ["POST"]
    pattern: '/api/v1/projects/:projectId/initialization/complete'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/project_initialization').completeProjectInitializationValidator)>>
      paramsTuple: [ParamValue]
      params: { projectId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/project_initialization').completeProjectInitializationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/project_initializations_controller').default['complete']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/project_initializations_controller').default['complete']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'projects.project_initializations.fail': {
    methods: ["POST"]
    pattern: '/api/v1/projects/:projectId/initialization/fail'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/project_initialization').failProjectInitializationValidator)>>
      paramsTuple: [ParamValue]
      params: { projectId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/project_initialization').failProjectInitializationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/project_initializations_controller').default['fail']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/project_initializations_controller').default['fail']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'providers.provider_credentials.catalog': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/providers/catalog'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/provider_credentials_controller').default['catalog']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/provider_credentials_controller').default['catalog']>>>
    }
  }
  'providers.provider_credentials.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/providers/credentials'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/provider_credentials_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/provider_credentials_controller').default['index']>>>
    }
  }
  'providers.provider_credentials.store': {
    methods: ["POST"]
    pattern: '/api/v1/providers/credentials'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/provider_credential').saveProviderCredentialValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/provider_credential').saveProviderCredentialValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/provider_credentials_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/provider_credentials_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'providers.provider_credentials.store_o_auth': {
    methods: ["POST"]
    pattern: '/api/v1/providers/credentials/oauth'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/provider_credentials_controller').default['storeOAuth']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/provider_credentials_controller').default['storeOAuth']>>>
    }
  }
  'providers.provider_credentials.resolve': {
    methods: ["POST"]
    pattern: '/api/v1/providers/credentials/resolve'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/provider_credential').resolveProviderCredentialValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/provider_credential').resolveProviderCredentialValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/provider_credentials_controller').default['resolve']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/provider_credentials_controller').default['resolve']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'providers.provider_credentials.destroy': {
    methods: ["DELETE"]
    pattern: '/api/v1/providers/credentials/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/provider_credentials_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/provider_credentials_controller').default['destroy']>>>
    }
  }
  'projects.user_stories.user_stories.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/projects/user-stories'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/user_story').listUserStoriesValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/user_stories_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/user_stories_controller').default['index']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'projects.user_stories.user_stories.store': {
    methods: ["POST"]
    pattern: '/api/v1/projects/user-stories'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user_story').createUserStoryValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user_story').createUserStoryValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/user_stories_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/user_stories_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'projects.user_stories.user_stories.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/projects/user-stories/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/user_stories_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/user_stories_controller').default['show']>>>
    }
  }
  'projects.user_stories.user_stories.update': {
    methods: ["PATCH"]
    pattern: '/api/v1/projects/user-stories/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user_story').updateUserStoryValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/user_story').updateUserStoryValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/user_stories_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/user_stories_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'projects.user_stories.user_stories.destroy': {
    methods: ["DELETE"]
    pattern: '/api/v1/projects/user-stories/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/user_stories_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/user_stories_controller').default['destroy']>>>
    }
  }
  'projects.user_stories.user_stories.activity_detail': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/projects/user-stories/:id/agent-activities/:activityId'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { id: ParamValue; activityId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/user_stories_controller').default['activityDetail']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/user_stories_controller').default['activityDetail']>>>
    }
  }
  'projects.user_stories.user_story_agent_runs.store': {
    methods: ["POST"]
    pattern: '/api/v1/projects/user-stories/:id/agent-runs'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user_story_agent_run').createUserStoryAgentRunValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/user_story_agent_run').createUserStoryAgentRunValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/user_story_agent_runs_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/user_story_agent_runs_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'projects.user_stories.user_story_agent_runs.update': {
    methods: ["PATCH"]
    pattern: '/api/v1/projects/user-stories/:id/agent-runs/:runId'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user_story_agent_run').updateUserStoryAgentRunValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { id: ParamValue; runId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/user_story_agent_run').updateUserStoryAgentRunValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/user_story_agent_runs_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/user_story_agent_runs_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'projects.user_stories.user_story_agent_runs.activity_detail': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/projects/user-stories/:id/agent-runs/:runId/activities/:activityId'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue, ParamValue]
      params: { id: ParamValue; runId: ParamValue; activityId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/user_story_agent_runs_controller').default['activityDetail']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/user_story_agent_runs_controller').default['activityDetail']>>>
    }
  }
  'projects.user_stories.user_story_comments.store': {
    methods: ["POST"]
    pattern: '/api/v1/projects/user-stories/:id/comments'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user_story_comment').createUserStoryCommentValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/user_story_comment').createUserStoryCommentValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/user_story_comments_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/user_story_comments_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
}
