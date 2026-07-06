/* eslint-disable prettier/prettier */
import type { AdonisEndpoint } from '@tuyau/core/types'
import type { Registry } from './schema.d.ts'
import type { ApiDefinition } from './tree.d.ts'

const placeholder: any = {}

const routes = {
  'auth.new_account.store': {
    methods: ["POST"],
    pattern: '/api/v1/auth/signup',
    tokens: [{"old":"/api/v1/auth/signup","type":0,"val":"api","end":""},{"old":"/api/v1/auth/signup","type":0,"val":"v1","end":""},{"old":"/api/v1/auth/signup","type":0,"val":"auth","end":""},{"old":"/api/v1/auth/signup","type":0,"val":"signup","end":""}],
    types: placeholder as Registry['auth.new_account.store']['types'],
  },
  'auth.access_tokens.store': {
    methods: ["POST"],
    pattern: '/api/v1/auth/login',
    tokens: [{"old":"/api/v1/auth/login","type":0,"val":"api","end":""},{"old":"/api/v1/auth/login","type":0,"val":"v1","end":""},{"old":"/api/v1/auth/login","type":0,"val":"auth","end":""},{"old":"/api/v1/auth/login","type":0,"val":"login","end":""}],
    types: placeholder as Registry['auth.access_tokens.store']['types'],
  },
  'profile.profile.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/account/profile',
    tokens: [{"old":"/api/v1/account/profile","type":0,"val":"api","end":""},{"old":"/api/v1/account/profile","type":0,"val":"v1","end":""},{"old":"/api/v1/account/profile","type":0,"val":"account","end":""},{"old":"/api/v1/account/profile","type":0,"val":"profile","end":""}],
    types: placeholder as Registry['profile.profile.show']['types'],
  },
  'profile.user_ai_preferences.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/account/ai-preferences',
    tokens: [{"old":"/api/v1/account/ai-preferences","type":0,"val":"api","end":""},{"old":"/api/v1/account/ai-preferences","type":0,"val":"v1","end":""},{"old":"/api/v1/account/ai-preferences","type":0,"val":"account","end":""},{"old":"/api/v1/account/ai-preferences","type":0,"val":"ai-preferences","end":""}],
    types: placeholder as Registry['profile.user_ai_preferences.show']['types'],
  },
  'profile.user_ai_preferences.update': {
    methods: ["PUT"],
    pattern: '/api/v1/account/ai-preferences',
    tokens: [{"old":"/api/v1/account/ai-preferences","type":0,"val":"api","end":""},{"old":"/api/v1/account/ai-preferences","type":0,"val":"v1","end":""},{"old":"/api/v1/account/ai-preferences","type":0,"val":"account","end":""},{"old":"/api/v1/account/ai-preferences","type":0,"val":"ai-preferences","end":""}],
    types: placeholder as Registry['profile.user_ai_preferences.update']['types'],
  },
  'profile.access_tokens.destroy': {
    methods: ["POST"],
    pattern: '/api/v1/account/logout',
    tokens: [{"old":"/api/v1/account/logout","type":0,"val":"api","end":""},{"old":"/api/v1/account/logout","type":0,"val":"v1","end":""},{"old":"/api/v1/account/logout","type":0,"val":"account","end":""},{"old":"/api/v1/account/logout","type":0,"val":"logout","end":""}],
    types: placeholder as Registry['profile.access_tokens.destroy']['types'],
  },
  'projects.projects.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/projects',
    tokens: [{"old":"/api/v1/projects","type":0,"val":"api","end":""},{"old":"/api/v1/projects","type":0,"val":"v1","end":""},{"old":"/api/v1/projects","type":0,"val":"projects","end":""}],
    types: placeholder as Registry['projects.projects.index']['types'],
  },
  'projects.projects.store': {
    methods: ["POST"],
    pattern: '/api/v1/projects',
    tokens: [{"old":"/api/v1/projects","type":0,"val":"api","end":""},{"old":"/api/v1/projects","type":0,"val":"v1","end":""},{"old":"/api/v1/projects","type":0,"val":"projects","end":""}],
    types: placeholder as Registry['projects.projects.store']['types'],
  },
  'projects.project_code_practices.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/projects/:projectId/code-practices',
    tokens: [{"old":"/api/v1/projects/:projectId/code-practices","type":0,"val":"api","end":""},{"old":"/api/v1/projects/:projectId/code-practices","type":0,"val":"v1","end":""},{"old":"/api/v1/projects/:projectId/code-practices","type":0,"val":"projects","end":""},{"old":"/api/v1/projects/:projectId/code-practices","type":1,"val":"projectId","end":""},{"old":"/api/v1/projects/:projectId/code-practices","type":0,"val":"code-practices","end":""}],
    types: placeholder as Registry['projects.project_code_practices.index']['types'],
  },
  'projects.project_code_practices.update': {
    methods: ["PATCH"],
    pattern: '/api/v1/projects/:projectId/code-practices/:practice',
    tokens: [{"old":"/api/v1/projects/:projectId/code-practices/:practice","type":0,"val":"api","end":""},{"old":"/api/v1/projects/:projectId/code-practices/:practice","type":0,"val":"v1","end":""},{"old":"/api/v1/projects/:projectId/code-practices/:practice","type":0,"val":"projects","end":""},{"old":"/api/v1/projects/:projectId/code-practices/:practice","type":1,"val":"projectId","end":""},{"old":"/api/v1/projects/:projectId/code-practices/:practice","type":0,"val":"code-practices","end":""},{"old":"/api/v1/projects/:projectId/code-practices/:practice","type":1,"val":"practice","end":""}],
    types: placeholder as Registry['projects.project_code_practices.update']['types'],
  },
  'projects.project_initializations.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/projects/:projectId/initialization',
    tokens: [{"old":"/api/v1/projects/:projectId/initialization","type":0,"val":"api","end":""},{"old":"/api/v1/projects/:projectId/initialization","type":0,"val":"v1","end":""},{"old":"/api/v1/projects/:projectId/initialization","type":0,"val":"projects","end":""},{"old":"/api/v1/projects/:projectId/initialization","type":1,"val":"projectId","end":""},{"old":"/api/v1/projects/:projectId/initialization","type":0,"val":"initialization","end":""}],
    types: placeholder as Registry['projects.project_initializations.show']['types'],
  },
  'projects.project_initializations.start': {
    methods: ["POST"],
    pattern: '/api/v1/projects/:projectId/initialization/start',
    tokens: [{"old":"/api/v1/projects/:projectId/initialization/start","type":0,"val":"api","end":""},{"old":"/api/v1/projects/:projectId/initialization/start","type":0,"val":"v1","end":""},{"old":"/api/v1/projects/:projectId/initialization/start","type":0,"val":"projects","end":""},{"old":"/api/v1/projects/:projectId/initialization/start","type":1,"val":"projectId","end":""},{"old":"/api/v1/projects/:projectId/initialization/start","type":0,"val":"initialization","end":""},{"old":"/api/v1/projects/:projectId/initialization/start","type":0,"val":"start","end":""}],
    types: placeholder as Registry['projects.project_initializations.start']['types'],
  },
  'projects.project_initializations.complete': {
    methods: ["POST"],
    pattern: '/api/v1/projects/:projectId/initialization/complete',
    tokens: [{"old":"/api/v1/projects/:projectId/initialization/complete","type":0,"val":"api","end":""},{"old":"/api/v1/projects/:projectId/initialization/complete","type":0,"val":"v1","end":""},{"old":"/api/v1/projects/:projectId/initialization/complete","type":0,"val":"projects","end":""},{"old":"/api/v1/projects/:projectId/initialization/complete","type":1,"val":"projectId","end":""},{"old":"/api/v1/projects/:projectId/initialization/complete","type":0,"val":"initialization","end":""},{"old":"/api/v1/projects/:projectId/initialization/complete","type":0,"val":"complete","end":""}],
    types: placeholder as Registry['projects.project_initializations.complete']['types'],
  },
  'projects.project_initializations.fail': {
    methods: ["POST"],
    pattern: '/api/v1/projects/:projectId/initialization/fail',
    tokens: [{"old":"/api/v1/projects/:projectId/initialization/fail","type":0,"val":"api","end":""},{"old":"/api/v1/projects/:projectId/initialization/fail","type":0,"val":"v1","end":""},{"old":"/api/v1/projects/:projectId/initialization/fail","type":0,"val":"projects","end":""},{"old":"/api/v1/projects/:projectId/initialization/fail","type":1,"val":"projectId","end":""},{"old":"/api/v1/projects/:projectId/initialization/fail","type":0,"val":"initialization","end":""},{"old":"/api/v1/projects/:projectId/initialization/fail","type":0,"val":"fail","end":""}],
    types: placeholder as Registry['projects.project_initializations.fail']['types'],
  },
  'projects.project_initializations.repair': {
    methods: ["POST"],
    pattern: '/api/v1/projects/:projectId/initialization/repair',
    tokens: [{"old":"/api/v1/projects/:projectId/initialization/repair","type":0,"val":"api","end":""},{"old":"/api/v1/projects/:projectId/initialization/repair","type":0,"val":"v1","end":""},{"old":"/api/v1/projects/:projectId/initialization/repair","type":0,"val":"projects","end":""},{"old":"/api/v1/projects/:projectId/initialization/repair","type":1,"val":"projectId","end":""},{"old":"/api/v1/projects/:projectId/initialization/repair","type":0,"val":"initialization","end":""},{"old":"/api/v1/projects/:projectId/initialization/repair","type":0,"val":"repair","end":""}],
    types: placeholder as Registry['projects.project_initializations.repair']['types'],
  },
  'providers.provider_credentials.catalog': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/providers/catalog',
    tokens: [{"old":"/api/v1/providers/catalog","type":0,"val":"api","end":""},{"old":"/api/v1/providers/catalog","type":0,"val":"v1","end":""},{"old":"/api/v1/providers/catalog","type":0,"val":"providers","end":""},{"old":"/api/v1/providers/catalog","type":0,"val":"catalog","end":""}],
    types: placeholder as Registry['providers.provider_credentials.catalog']['types'],
  },
  'providers.provider_credentials.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/providers/credentials',
    tokens: [{"old":"/api/v1/providers/credentials","type":0,"val":"api","end":""},{"old":"/api/v1/providers/credentials","type":0,"val":"v1","end":""},{"old":"/api/v1/providers/credentials","type":0,"val":"providers","end":""},{"old":"/api/v1/providers/credentials","type":0,"val":"credentials","end":""}],
    types: placeholder as Registry['providers.provider_credentials.index']['types'],
  },
  'providers.provider_credentials.store': {
    methods: ["POST"],
    pattern: '/api/v1/providers/credentials',
    tokens: [{"old":"/api/v1/providers/credentials","type":0,"val":"api","end":""},{"old":"/api/v1/providers/credentials","type":0,"val":"v1","end":""},{"old":"/api/v1/providers/credentials","type":0,"val":"providers","end":""},{"old":"/api/v1/providers/credentials","type":0,"val":"credentials","end":""}],
    types: placeholder as Registry['providers.provider_credentials.store']['types'],
  },
  'providers.provider_credentials.store_o_auth': {
    methods: ["POST"],
    pattern: '/api/v1/providers/credentials/oauth',
    tokens: [{"old":"/api/v1/providers/credentials/oauth","type":0,"val":"api","end":""},{"old":"/api/v1/providers/credentials/oauth","type":0,"val":"v1","end":""},{"old":"/api/v1/providers/credentials/oauth","type":0,"val":"providers","end":""},{"old":"/api/v1/providers/credentials/oauth","type":0,"val":"credentials","end":""},{"old":"/api/v1/providers/credentials/oauth","type":0,"val":"oauth","end":""}],
    types: placeholder as Registry['providers.provider_credentials.store_o_auth']['types'],
  },
  'providers.provider_credentials.resolve': {
    methods: ["POST"],
    pattern: '/api/v1/providers/credentials/resolve',
    tokens: [{"old":"/api/v1/providers/credentials/resolve","type":0,"val":"api","end":""},{"old":"/api/v1/providers/credentials/resolve","type":0,"val":"v1","end":""},{"old":"/api/v1/providers/credentials/resolve","type":0,"val":"providers","end":""},{"old":"/api/v1/providers/credentials/resolve","type":0,"val":"credentials","end":""},{"old":"/api/v1/providers/credentials/resolve","type":0,"val":"resolve","end":""}],
    types: placeholder as Registry['providers.provider_credentials.resolve']['types'],
  },
  'providers.provider_credentials.destroy': {
    methods: ["DELETE"],
    pattern: '/api/v1/providers/credentials/:id',
    tokens: [{"old":"/api/v1/providers/credentials/:id","type":0,"val":"api","end":""},{"old":"/api/v1/providers/credentials/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/providers/credentials/:id","type":0,"val":"providers","end":""},{"old":"/api/v1/providers/credentials/:id","type":0,"val":"credentials","end":""},{"old":"/api/v1/providers/credentials/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['providers.provider_credentials.destroy']['types'],
  },
  'projects.quick_chats.quick_chats.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/projects/quick-chats',
    tokens: [{"old":"/api/v1/projects/quick-chats","type":0,"val":"api","end":""},{"old":"/api/v1/projects/quick-chats","type":0,"val":"v1","end":""},{"old":"/api/v1/projects/quick-chats","type":0,"val":"projects","end":""},{"old":"/api/v1/projects/quick-chats","type":0,"val":"quick-chats","end":""}],
    types: placeholder as Registry['projects.quick_chats.quick_chats.index']['types'],
  },
  'projects.quick_chats.quick_chats.store': {
    methods: ["POST"],
    pattern: '/api/v1/projects/quick-chats',
    tokens: [{"old":"/api/v1/projects/quick-chats","type":0,"val":"api","end":""},{"old":"/api/v1/projects/quick-chats","type":0,"val":"v1","end":""},{"old":"/api/v1/projects/quick-chats","type":0,"val":"projects","end":""},{"old":"/api/v1/projects/quick-chats","type":0,"val":"quick-chats","end":""}],
    types: placeholder as Registry['projects.quick_chats.quick_chats.store']['types'],
  },
  'projects.quick_chats.quick_chats.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/projects/quick-chats/:id',
    tokens: [{"old":"/api/v1/projects/quick-chats/:id","type":0,"val":"api","end":""},{"old":"/api/v1/projects/quick-chats/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/projects/quick-chats/:id","type":0,"val":"projects","end":""},{"old":"/api/v1/projects/quick-chats/:id","type":0,"val":"quick-chats","end":""},{"old":"/api/v1/projects/quick-chats/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['projects.quick_chats.quick_chats.show']['types'],
  },
  'projects.quick_chats.quick_chats.update': {
    methods: ["PATCH"],
    pattern: '/api/v1/projects/quick-chats/:id',
    tokens: [{"old":"/api/v1/projects/quick-chats/:id","type":0,"val":"api","end":""},{"old":"/api/v1/projects/quick-chats/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/projects/quick-chats/:id","type":0,"val":"projects","end":""},{"old":"/api/v1/projects/quick-chats/:id","type":0,"val":"quick-chats","end":""},{"old":"/api/v1/projects/quick-chats/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['projects.quick_chats.quick_chats.update']['types'],
  },
  'projects.quick_chats.quick_chats.destroy': {
    methods: ["DELETE"],
    pattern: '/api/v1/projects/quick-chats/:id',
    tokens: [{"old":"/api/v1/projects/quick-chats/:id","type":0,"val":"api","end":""},{"old":"/api/v1/projects/quick-chats/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/projects/quick-chats/:id","type":0,"val":"projects","end":""},{"old":"/api/v1/projects/quick-chats/:id","type":0,"val":"quick-chats","end":""},{"old":"/api/v1/projects/quick-chats/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['projects.quick_chats.quick_chats.destroy']['types'],
  },
  'projects.quick_chats.quick_chat_messages.store': {
    methods: ["POST"],
    pattern: '/api/v1/projects/quick-chats/:id/messages',
    tokens: [{"old":"/api/v1/projects/quick-chats/:id/messages","type":0,"val":"api","end":""},{"old":"/api/v1/projects/quick-chats/:id/messages","type":0,"val":"v1","end":""},{"old":"/api/v1/projects/quick-chats/:id/messages","type":0,"val":"projects","end":""},{"old":"/api/v1/projects/quick-chats/:id/messages","type":0,"val":"quick-chats","end":""},{"old":"/api/v1/projects/quick-chats/:id/messages","type":1,"val":"id","end":""},{"old":"/api/v1/projects/quick-chats/:id/messages","type":0,"val":"messages","end":""}],
    types: placeholder as Registry['projects.quick_chats.quick_chat_messages.store']['types'],
  },
  'projects.quick_chats.quick_chat_messages.undo': {
    methods: ["POST"],
    pattern: '/api/v1/projects/quick-chats/:id/messages/:messageId/undo',
    tokens: [{"old":"/api/v1/projects/quick-chats/:id/messages/:messageId/undo","type":0,"val":"api","end":""},{"old":"/api/v1/projects/quick-chats/:id/messages/:messageId/undo","type":0,"val":"v1","end":""},{"old":"/api/v1/projects/quick-chats/:id/messages/:messageId/undo","type":0,"val":"projects","end":""},{"old":"/api/v1/projects/quick-chats/:id/messages/:messageId/undo","type":0,"val":"quick-chats","end":""},{"old":"/api/v1/projects/quick-chats/:id/messages/:messageId/undo","type":1,"val":"id","end":""},{"old":"/api/v1/projects/quick-chats/:id/messages/:messageId/undo","type":0,"val":"messages","end":""},{"old":"/api/v1/projects/quick-chats/:id/messages/:messageId/undo","type":1,"val":"messageId","end":""},{"old":"/api/v1/projects/quick-chats/:id/messages/:messageId/undo","type":0,"val":"undo","end":""}],
    types: placeholder as Registry['projects.quick_chats.quick_chat_messages.undo']['types'],
  },
  'projects.quick_chats.quick_chat_agent_runs.store': {
    methods: ["POST"],
    pattern: '/api/v1/projects/quick-chats/:id/agent-runs',
    tokens: [{"old":"/api/v1/projects/quick-chats/:id/agent-runs","type":0,"val":"api","end":""},{"old":"/api/v1/projects/quick-chats/:id/agent-runs","type":0,"val":"v1","end":""},{"old":"/api/v1/projects/quick-chats/:id/agent-runs","type":0,"val":"projects","end":""},{"old":"/api/v1/projects/quick-chats/:id/agent-runs","type":0,"val":"quick-chats","end":""},{"old":"/api/v1/projects/quick-chats/:id/agent-runs","type":1,"val":"id","end":""},{"old":"/api/v1/projects/quick-chats/:id/agent-runs","type":0,"val":"agent-runs","end":""}],
    types: placeholder as Registry['projects.quick_chats.quick_chat_agent_runs.store']['types'],
  },
  'projects.quick_chats.quick_chat_agent_runs.update': {
    methods: ["PATCH"],
    pattern: '/api/v1/projects/quick-chats/:id/agent-runs/:runId',
    tokens: [{"old":"/api/v1/projects/quick-chats/:id/agent-runs/:runId","type":0,"val":"api","end":""},{"old":"/api/v1/projects/quick-chats/:id/agent-runs/:runId","type":0,"val":"v1","end":""},{"old":"/api/v1/projects/quick-chats/:id/agent-runs/:runId","type":0,"val":"projects","end":""},{"old":"/api/v1/projects/quick-chats/:id/agent-runs/:runId","type":0,"val":"quick-chats","end":""},{"old":"/api/v1/projects/quick-chats/:id/agent-runs/:runId","type":1,"val":"id","end":""},{"old":"/api/v1/projects/quick-chats/:id/agent-runs/:runId","type":0,"val":"agent-runs","end":""},{"old":"/api/v1/projects/quick-chats/:id/agent-runs/:runId","type":1,"val":"runId","end":""}],
    types: placeholder as Registry['projects.quick_chats.quick_chat_agent_runs.update']['types'],
  },
  'projects.quick_chats.quick_chat_agent_runs.activity_detail': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/projects/quick-chats/:id/agent-runs/:runId/activities/:activityId',
    tokens: [{"old":"/api/v1/projects/quick-chats/:id/agent-runs/:runId/activities/:activityId","type":0,"val":"api","end":""},{"old":"/api/v1/projects/quick-chats/:id/agent-runs/:runId/activities/:activityId","type":0,"val":"v1","end":""},{"old":"/api/v1/projects/quick-chats/:id/agent-runs/:runId/activities/:activityId","type":0,"val":"projects","end":""},{"old":"/api/v1/projects/quick-chats/:id/agent-runs/:runId/activities/:activityId","type":0,"val":"quick-chats","end":""},{"old":"/api/v1/projects/quick-chats/:id/agent-runs/:runId/activities/:activityId","type":1,"val":"id","end":""},{"old":"/api/v1/projects/quick-chats/:id/agent-runs/:runId/activities/:activityId","type":0,"val":"agent-runs","end":""},{"old":"/api/v1/projects/quick-chats/:id/agent-runs/:runId/activities/:activityId","type":1,"val":"runId","end":""},{"old":"/api/v1/projects/quick-chats/:id/agent-runs/:runId/activities/:activityId","type":0,"val":"activities","end":""},{"old":"/api/v1/projects/quick-chats/:id/agent-runs/:runId/activities/:activityId","type":1,"val":"activityId","end":""}],
    types: placeholder as Registry['projects.quick_chats.quick_chat_agent_runs.activity_detail']['types'],
  },
  'projects.user_stories.user_stories.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/projects/user-stories',
    tokens: [{"old":"/api/v1/projects/user-stories","type":0,"val":"api","end":""},{"old":"/api/v1/projects/user-stories","type":0,"val":"v1","end":""},{"old":"/api/v1/projects/user-stories","type":0,"val":"projects","end":""},{"old":"/api/v1/projects/user-stories","type":0,"val":"user-stories","end":""}],
    types: placeholder as Registry['projects.user_stories.user_stories.index']['types'],
  },
  'projects.user_stories.user_stories.store': {
    methods: ["POST"],
    pattern: '/api/v1/projects/user-stories',
    tokens: [{"old":"/api/v1/projects/user-stories","type":0,"val":"api","end":""},{"old":"/api/v1/projects/user-stories","type":0,"val":"v1","end":""},{"old":"/api/v1/projects/user-stories","type":0,"val":"projects","end":""},{"old":"/api/v1/projects/user-stories","type":0,"val":"user-stories","end":""}],
    types: placeholder as Registry['projects.user_stories.user_stories.store']['types'],
  },
  'projects.user_stories.user_stories.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/projects/user-stories/:id',
    tokens: [{"old":"/api/v1/projects/user-stories/:id","type":0,"val":"api","end":""},{"old":"/api/v1/projects/user-stories/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/projects/user-stories/:id","type":0,"val":"projects","end":""},{"old":"/api/v1/projects/user-stories/:id","type":0,"val":"user-stories","end":""},{"old":"/api/v1/projects/user-stories/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['projects.user_stories.user_stories.show']['types'],
  },
  'projects.user_stories.user_stories.update': {
    methods: ["PATCH"],
    pattern: '/api/v1/projects/user-stories/:id',
    tokens: [{"old":"/api/v1/projects/user-stories/:id","type":0,"val":"api","end":""},{"old":"/api/v1/projects/user-stories/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/projects/user-stories/:id","type":0,"val":"projects","end":""},{"old":"/api/v1/projects/user-stories/:id","type":0,"val":"user-stories","end":""},{"old":"/api/v1/projects/user-stories/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['projects.user_stories.user_stories.update']['types'],
  },
  'projects.user_stories.user_stories.destroy': {
    methods: ["DELETE"],
    pattern: '/api/v1/projects/user-stories/:id',
    tokens: [{"old":"/api/v1/projects/user-stories/:id","type":0,"val":"api","end":""},{"old":"/api/v1/projects/user-stories/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/projects/user-stories/:id","type":0,"val":"projects","end":""},{"old":"/api/v1/projects/user-stories/:id","type":0,"val":"user-stories","end":""},{"old":"/api/v1/projects/user-stories/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['projects.user_stories.user_stories.destroy']['types'],
  },
  'projects.user_stories.user_stories.activity_detail': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/projects/user-stories/:id/agent-activities/:activityId',
    tokens: [{"old":"/api/v1/projects/user-stories/:id/agent-activities/:activityId","type":0,"val":"api","end":""},{"old":"/api/v1/projects/user-stories/:id/agent-activities/:activityId","type":0,"val":"v1","end":""},{"old":"/api/v1/projects/user-stories/:id/agent-activities/:activityId","type":0,"val":"projects","end":""},{"old":"/api/v1/projects/user-stories/:id/agent-activities/:activityId","type":0,"val":"user-stories","end":""},{"old":"/api/v1/projects/user-stories/:id/agent-activities/:activityId","type":1,"val":"id","end":""},{"old":"/api/v1/projects/user-stories/:id/agent-activities/:activityId","type":0,"val":"agent-activities","end":""},{"old":"/api/v1/projects/user-stories/:id/agent-activities/:activityId","type":1,"val":"activityId","end":""}],
    types: placeholder as Registry['projects.user_stories.user_stories.activity_detail']['types'],
  },
  'projects.user_stories.user_story_agent_runs.store': {
    methods: ["POST"],
    pattern: '/api/v1/projects/user-stories/:id/agent-runs',
    tokens: [{"old":"/api/v1/projects/user-stories/:id/agent-runs","type":0,"val":"api","end":""},{"old":"/api/v1/projects/user-stories/:id/agent-runs","type":0,"val":"v1","end":""},{"old":"/api/v1/projects/user-stories/:id/agent-runs","type":0,"val":"projects","end":""},{"old":"/api/v1/projects/user-stories/:id/agent-runs","type":0,"val":"user-stories","end":""},{"old":"/api/v1/projects/user-stories/:id/agent-runs","type":1,"val":"id","end":""},{"old":"/api/v1/projects/user-stories/:id/agent-runs","type":0,"val":"agent-runs","end":""}],
    types: placeholder as Registry['projects.user_stories.user_story_agent_runs.store']['types'],
  },
  'projects.user_stories.user_story_agent_runs.update': {
    methods: ["PATCH"],
    pattern: '/api/v1/projects/user-stories/:id/agent-runs/:runId',
    tokens: [{"old":"/api/v1/projects/user-stories/:id/agent-runs/:runId","type":0,"val":"api","end":""},{"old":"/api/v1/projects/user-stories/:id/agent-runs/:runId","type":0,"val":"v1","end":""},{"old":"/api/v1/projects/user-stories/:id/agent-runs/:runId","type":0,"val":"projects","end":""},{"old":"/api/v1/projects/user-stories/:id/agent-runs/:runId","type":0,"val":"user-stories","end":""},{"old":"/api/v1/projects/user-stories/:id/agent-runs/:runId","type":1,"val":"id","end":""},{"old":"/api/v1/projects/user-stories/:id/agent-runs/:runId","type":0,"val":"agent-runs","end":""},{"old":"/api/v1/projects/user-stories/:id/agent-runs/:runId","type":1,"val":"runId","end":""}],
    types: placeholder as Registry['projects.user_stories.user_story_agent_runs.update']['types'],
  },
  'projects.user_stories.user_story_agent_runs.activity_detail': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/projects/user-stories/:id/agent-runs/:runId/activities/:activityId',
    tokens: [{"old":"/api/v1/projects/user-stories/:id/agent-runs/:runId/activities/:activityId","type":0,"val":"api","end":""},{"old":"/api/v1/projects/user-stories/:id/agent-runs/:runId/activities/:activityId","type":0,"val":"v1","end":""},{"old":"/api/v1/projects/user-stories/:id/agent-runs/:runId/activities/:activityId","type":0,"val":"projects","end":""},{"old":"/api/v1/projects/user-stories/:id/agent-runs/:runId/activities/:activityId","type":0,"val":"user-stories","end":""},{"old":"/api/v1/projects/user-stories/:id/agent-runs/:runId/activities/:activityId","type":1,"val":"id","end":""},{"old":"/api/v1/projects/user-stories/:id/agent-runs/:runId/activities/:activityId","type":0,"val":"agent-runs","end":""},{"old":"/api/v1/projects/user-stories/:id/agent-runs/:runId/activities/:activityId","type":1,"val":"runId","end":""},{"old":"/api/v1/projects/user-stories/:id/agent-runs/:runId/activities/:activityId","type":0,"val":"activities","end":""},{"old":"/api/v1/projects/user-stories/:id/agent-runs/:runId/activities/:activityId","type":1,"val":"activityId","end":""}],
    types: placeholder as Registry['projects.user_stories.user_story_agent_runs.activity_detail']['types'],
  },
  'projects.user_stories.user_story_comments.store': {
    methods: ["POST"],
    pattern: '/api/v1/projects/user-stories/:id/comments',
    tokens: [{"old":"/api/v1/projects/user-stories/:id/comments","type":0,"val":"api","end":""},{"old":"/api/v1/projects/user-stories/:id/comments","type":0,"val":"v1","end":""},{"old":"/api/v1/projects/user-stories/:id/comments","type":0,"val":"projects","end":""},{"old":"/api/v1/projects/user-stories/:id/comments","type":0,"val":"user-stories","end":""},{"old":"/api/v1/projects/user-stories/:id/comments","type":1,"val":"id","end":""},{"old":"/api/v1/projects/user-stories/:id/comments","type":0,"val":"comments","end":""}],
    types: placeholder as Registry['projects.user_stories.user_story_comments.store']['types'],
  },
  'projects.user_stories.user_story_comments.undo': {
    methods: ["POST"],
    pattern: '/api/v1/projects/user-stories/:id/comments/:commentId/undo',
    tokens: [{"old":"/api/v1/projects/user-stories/:id/comments/:commentId/undo","type":0,"val":"api","end":""},{"old":"/api/v1/projects/user-stories/:id/comments/:commentId/undo","type":0,"val":"v1","end":""},{"old":"/api/v1/projects/user-stories/:id/comments/:commentId/undo","type":0,"val":"projects","end":""},{"old":"/api/v1/projects/user-stories/:id/comments/:commentId/undo","type":0,"val":"user-stories","end":""},{"old":"/api/v1/projects/user-stories/:id/comments/:commentId/undo","type":1,"val":"id","end":""},{"old":"/api/v1/projects/user-stories/:id/comments/:commentId/undo","type":0,"val":"comments","end":""},{"old":"/api/v1/projects/user-stories/:id/comments/:commentId/undo","type":1,"val":"commentId","end":""},{"old":"/api/v1/projects/user-stories/:id/comments/:commentId/undo","type":0,"val":"undo","end":""}],
    types: placeholder as Registry['projects.user_stories.user_story_comments.undo']['types'],
  },
} as const satisfies Record<string, AdonisEndpoint>

export { routes }

export const registry = {
  routes,
  $tree: {} as ApiDefinition,
}

declare module '@tuyau/core/types' {
  export interface UserRegistry {
    routes: typeof routes
    $tree: ApiDefinition
  }
}
