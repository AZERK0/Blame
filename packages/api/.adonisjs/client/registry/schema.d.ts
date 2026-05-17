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
}
