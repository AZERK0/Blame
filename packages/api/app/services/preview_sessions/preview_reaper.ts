import PreviewSessionService from '#services/preview_sessions/preview_session_service'

export default class PreviewReaper {
  constructor(private readonly sessions = new PreviewSessionService()) {}

  run(limit = 50) {
    return this.sessions.reconcileExpired(limit)
  }
}
