import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'auth.new_account.store': { paramsTuple?: []; params?: {} }
    'auth.access_tokens.store': { paramsTuple?: []; params?: {} }
    'profile.profile.show': { paramsTuple?: []; params?: {} }
    'profile.access_tokens.destroy': { paramsTuple?: []; params?: {} }
    'projects.projects.index': { paramsTuple?: []; params?: {} }
    'projects.projects.store': { paramsTuple?: []; params?: {} }
    'projects.project_code_practices.index': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'projects.project_code_practices.update': { paramsTuple: [ParamValue,ParamValue]; params: {'projectId': ParamValue,'practice': ParamValue} }
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
  }
  GET: {
    'profile.profile.show': { paramsTuple?: []; params?: {} }
    'projects.projects.index': { paramsTuple?: []; params?: {} }
    'projects.project_code_practices.index': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'projects.project_initializations.show': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'providers.provider_credentials.catalog': { paramsTuple?: []; params?: {} }
    'providers.provider_credentials.index': { paramsTuple?: []; params?: {} }
    'projects.user_stories.user_stories.index': { paramsTuple?: []; params?: {} }
    'projects.user_stories.user_stories.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'projects.user_stories.user_stories.activity_detail': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'activityId': ParamValue} }
    'projects.user_stories.user_story_agent_runs.activity_detail': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'id': ParamValue,'runId': ParamValue,'activityId': ParamValue} }
  }
  HEAD: {
    'profile.profile.show': { paramsTuple?: []; params?: {} }
    'projects.projects.index': { paramsTuple?: []; params?: {} }
    'projects.project_code_practices.index': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'projects.project_initializations.show': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'providers.provider_credentials.catalog': { paramsTuple?: []; params?: {} }
    'providers.provider_credentials.index': { paramsTuple?: []; params?: {} }
    'projects.user_stories.user_stories.index': { paramsTuple?: []; params?: {} }
    'projects.user_stories.user_stories.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'projects.user_stories.user_stories.activity_detail': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'activityId': ParamValue} }
    'projects.user_stories.user_story_agent_runs.activity_detail': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'id': ParamValue,'runId': ParamValue,'activityId': ParamValue} }
  }
  POST: {
    'auth.new_account.store': { paramsTuple?: []; params?: {} }
    'auth.access_tokens.store': { paramsTuple?: []; params?: {} }
    'profile.access_tokens.destroy': { paramsTuple?: []; params?: {} }
    'projects.projects.store': { paramsTuple?: []; params?: {} }
    'projects.project_initializations.start': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'projects.project_initializations.complete': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'projects.project_initializations.fail': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'projects.project_initializations.repair': { paramsTuple: [ParamValue]; params: {'projectId': ParamValue} }
    'providers.provider_credentials.store': { paramsTuple?: []; params?: {} }
    'providers.provider_credentials.store_o_auth': { paramsTuple?: []; params?: {} }
    'providers.provider_credentials.resolve': { paramsTuple?: []; params?: {} }
    'projects.user_stories.user_stories.store': { paramsTuple?: []; params?: {} }
    'projects.user_stories.user_story_agent_runs.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'projects.user_stories.user_story_comments.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  PATCH: {
    'projects.project_code_practices.update': { paramsTuple: [ParamValue,ParamValue]; params: {'projectId': ParamValue,'practice': ParamValue} }
    'projects.user_stories.user_stories.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'projects.user_stories.user_story_agent_runs.update': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'runId': ParamValue} }
  }
  DELETE: {
    'providers.provider_credentials.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'projects.user_stories.user_stories.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}