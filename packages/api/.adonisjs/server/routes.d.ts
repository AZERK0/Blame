import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'stripe_webhooks': { paramsTuple?: []; params?: {} }
    'account_privacy.status': { paramsTuple?: []; params?: {} }
    'consumer_contracts.withdraw': { paramsTuple?: []; params?: {} }
    'telemetry_ingestion.store': { paramsTuple: [ParamValue]; params: {'signal': ParamValue} }
    'telemetry_sessions.show': { paramsTuple?: []; params?: {} }
    'billing.billing.show': { paramsTuple?: []; params?: {} }
    'billing.billing.checkout': { paramsTuple?: []; params?: {} }
    'billing.billing.portal': { paramsTuple?: []; params?: {} }
    'desktop_auth.complete': { paramsTuple?: []; params?: {} }
    'desktop_auth.passkey': { paramsTuple?: []; params?: {} }
    'desktop_auth.reset_password': { paramsTuple?: []; params?: {} }
    'desktop_auth.verified': { paramsTuple?: []; params?: {} }
    'desktop_auth.exchange': { paramsTuple?: []; params?: {} }
    'auth.better': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
    'profile.profile.show': { paramsTuple?: []; params?: {} }
    'profile.user_ai_preferences.show': { paramsTuple?: []; params?: {} }
    'profile.user_ai_preferences.update': { paramsTuple?: []; params?: {} }
    'profile.user_mcp_configurations.show': { paramsTuple?: []; params?: {} }
    'profile.user_mcp_configurations.update': { paramsTuple?: []; params?: {} }
    'profile.account_privacy.download': { paramsTuple?: []; params?: {} }
    'profile.account_privacy.close': { paramsTuple?: []; params?: {} }
    'profile.access_tokens.destroy': { paramsTuple?: []; params?: {} }
    'projects.projects.index': { paramsTuple?: []; params?: {} }
    'projects.projects.store': { paramsTuple?: []; params?: {} }
    'projects.project_code_practices.index': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'projects.project_code_practices.update': { paramsTuple: [ParamValue,ParamValue]; params: {'projectId': ParamValue,'practice': ParamValue} }
    'projects.project_code_practice_analyses.show': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'projects.project_code_practice_analyses.start': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'projects.project_code_practice_analyses.complete': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'projects.project_code_practice_analyses.fail': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'projects.project_code_practice_analyses.viewed': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'projects.project_initializations.show': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'projects.project_initializations.start': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'projects.project_initializations.complete': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'projects.project_initializations.fail': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'projects.project_initializations.repair': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'providers.provider_credentials.catalog': { paramsTuple?: []; params?: {} }
    'providers.provider_credentials.index': { paramsTuple?: []; params?: {} }
    'providers.provider_credentials.store': { paramsTuple?: []; params?: {} }
    'providers.provider_credentials.store_o_auth': { paramsTuple?: []; params?: {} }
    'providers.provider_credentials.resolve': { paramsTuple?: []; params?: {} }
    'providers.provider_credentials.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'projects.quick_chats.quick_chats.index': { paramsTuple?: []; params?: {} }
    'projects.quick_chats.quick_chats.store': { paramsTuple?: []; params?: {} }
    'projects.quick_chats.quick_chats.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'projects.quick_chats.quick_chats.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'projects.quick_chats.quick_chats.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'projects.quick_chats.quick_chat_messages.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'projects.quick_chats.quick_chat_messages.undo': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'messageId': ParamValue} }
    'projects.quick_chats.quick_chat_messages.validate_undo': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'messageId': ParamValue} }
    'projects.quick_chats.quick_chat_agent_runs.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'projects.quick_chats.quick_chat_agent_runs.update': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'runId': ParamValue} }
    'projects.quick_chats.quick_chat_agent_runs.activity_detail': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'id': ParamValue,'runId': ParamValue,'activityId': ParamValue} }
    'projects.user_stories.user_stories.index': { paramsTuple?: []; params?: {} }
    'projects.user_stories.user_stories.store': { paramsTuple?: []; params?: {} }
    'projects.user_stories.user_stories.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'projects.user_stories.user_stories.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'projects.user_stories.user_stories.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'projects.user_stories.user_stories.activity_detail': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'activityId': ParamValue} }
    'projects.user_stories.user_story_agent_runs.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'projects.user_stories.user_story_agent_runs.update': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'runId': ParamValue} }
    'projects.user_stories.user_story_agent_runs.activity_detail': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'id': ParamValue,'runId': ParamValue,'activityId': ParamValue} }
    'projects.user_stories.user_story_comments.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'projects.user_stories.user_story_comments.undo': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'commentId': ParamValue} }
    'projects.user_stories.user_story_comments.validate_undo': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'commentId': ParamValue} }
  }
  GET: {
    'telemetry_sessions.show': { paramsTuple?: []; params?: {} }
    'billing.billing.show': { paramsTuple?: []; params?: {} }
    'desktop_auth.complete': { paramsTuple?: []; params?: {} }
    'desktop_auth.passkey': { paramsTuple?: []; params?: {} }
    'desktop_auth.reset_password': { paramsTuple?: []; params?: {} }
    'desktop_auth.verified': { paramsTuple?: []; params?: {} }
    'auth.better': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
    'profile.profile.show': { paramsTuple?: []; params?: {} }
    'profile.user_ai_preferences.show': { paramsTuple?: []; params?: {} }
    'profile.user_mcp_configurations.show': { paramsTuple?: []; params?: {} }
    'projects.projects.index': { paramsTuple?: []; params?: {} }
    'projects.project_code_practices.index': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'projects.project_code_practice_analyses.show': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'projects.project_initializations.show': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'providers.provider_credentials.catalog': { paramsTuple?: []; params?: {} }
    'providers.provider_credentials.index': { paramsTuple?: []; params?: {} }
    'projects.quick_chats.quick_chats.index': { paramsTuple?: []; params?: {} }
    'projects.quick_chats.quick_chats.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'projects.quick_chats.quick_chat_agent_runs.activity_detail': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'id': ParamValue,'runId': ParamValue,'activityId': ParamValue} }
    'projects.user_stories.user_stories.index': { paramsTuple?: []; params?: {} }
    'projects.user_stories.user_stories.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'projects.user_stories.user_stories.activity_detail': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'activityId': ParamValue} }
    'projects.user_stories.user_story_agent_runs.activity_detail': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'id': ParamValue,'runId': ParamValue,'activityId': ParamValue} }
  }
  HEAD: {
    'telemetry_sessions.show': { paramsTuple?: []; params?: {} }
    'billing.billing.show': { paramsTuple?: []; params?: {} }
    'desktop_auth.complete': { paramsTuple?: []; params?: {} }
    'desktop_auth.passkey': { paramsTuple?: []; params?: {} }
    'desktop_auth.reset_password': { paramsTuple?: []; params?: {} }
    'desktop_auth.verified': { paramsTuple?: []; params?: {} }
    'auth.better': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
    'profile.profile.show': { paramsTuple?: []; params?: {} }
    'profile.user_ai_preferences.show': { paramsTuple?: []; params?: {} }
    'profile.user_mcp_configurations.show': { paramsTuple?: []; params?: {} }
    'projects.projects.index': { paramsTuple?: []; params?: {} }
    'projects.project_code_practices.index': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'projects.project_code_practice_analyses.show': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'projects.project_initializations.show': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'providers.provider_credentials.catalog': { paramsTuple?: []; params?: {} }
    'providers.provider_credentials.index': { paramsTuple?: []; params?: {} }
    'projects.quick_chats.quick_chats.index': { paramsTuple?: []; params?: {} }
    'projects.quick_chats.quick_chats.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'projects.quick_chats.quick_chat_agent_runs.activity_detail': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'id': ParamValue,'runId': ParamValue,'activityId': ParamValue} }
    'projects.user_stories.user_stories.index': { paramsTuple?: []; params?: {} }
    'projects.user_stories.user_stories.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'projects.user_stories.user_stories.activity_detail': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'activityId': ParamValue} }
    'projects.user_stories.user_story_agent_runs.activity_detail': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'id': ParamValue,'runId': ParamValue,'activityId': ParamValue} }
  }
  POST: {
    'stripe_webhooks': { paramsTuple?: []; params?: {} }
    'account_privacy.status': { paramsTuple?: []; params?: {} }
    'consumer_contracts.withdraw': { paramsTuple?: []; params?: {} }
    'telemetry_ingestion.store': { paramsTuple: [ParamValue]; params: {'signal': ParamValue} }
    'billing.billing.checkout': { paramsTuple?: []; params?: {} }
    'billing.billing.portal': { paramsTuple?: []; params?: {} }
    'desktop_auth.exchange': { paramsTuple?: []; params?: {} }
    'auth.better': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
    'profile.account_privacy.download': { paramsTuple?: []; params?: {} }
    'profile.account_privacy.close': { paramsTuple?: []; params?: {} }
    'profile.access_tokens.destroy': { paramsTuple?: []; params?: {} }
    'projects.projects.store': { paramsTuple?: []; params?: {} }
    'projects.project_code_practice_analyses.start': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'projects.project_code_practice_analyses.complete': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'projects.project_code_practice_analyses.fail': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'projects.project_code_practice_analyses.viewed': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'projects.project_initializations.start': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'projects.project_initializations.complete': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'projects.project_initializations.fail': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'projects.project_initializations.repair': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'providers.provider_credentials.store': { paramsTuple?: []; params?: {} }
    'providers.provider_credentials.store_o_auth': { paramsTuple?: []; params?: {} }
    'providers.provider_credentials.resolve': { paramsTuple?: []; params?: {} }
    'projects.quick_chats.quick_chats.store': { paramsTuple?: []; params?: {} }
    'projects.quick_chats.quick_chat_messages.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'projects.quick_chats.quick_chat_messages.undo': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'messageId': ParamValue} }
    'projects.quick_chats.quick_chat_messages.validate_undo': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'messageId': ParamValue} }
    'projects.quick_chats.quick_chat_agent_runs.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'projects.user_stories.user_stories.store': { paramsTuple?: []; params?: {} }
    'projects.user_stories.user_story_agent_runs.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'projects.user_stories.user_story_comments.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'projects.user_stories.user_story_comments.undo': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'commentId': ParamValue} }
    'projects.user_stories.user_story_comments.validate_undo': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'commentId': ParamValue} }
  }
  OPTIONS: {
    'auth.better': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
  }
  PUT: {
    'auth.better': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
    'profile.user_ai_preferences.update': { paramsTuple?: []; params?: {} }
    'profile.user_mcp_configurations.update': { paramsTuple?: []; params?: {} }
  }
  PATCH: {
    'auth.better': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
    'projects.project_code_practices.update': { paramsTuple: [ParamValue,ParamValue]; params: {'projectId': ParamValue,'practice': ParamValue} }
    'projects.quick_chats.quick_chats.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'projects.quick_chats.quick_chat_agent_runs.update': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'runId': ParamValue} }
    'projects.user_stories.user_stories.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'projects.user_stories.user_story_agent_runs.update': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'runId': ParamValue} }
  }
  DELETE: {
    'auth.better': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
    'providers.provider_credentials.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'projects.quick_chats.quick_chats.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'projects.user_stories.user_stories.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}