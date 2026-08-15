import SecurityAuditsService from '#services/security_audits_service'
import { saveSecurityAuditValidator } from '#validators/security_audit'
import type { HttpContext } from '@adonisjs/core/http'

export default class SecurityAuditsController {
  async index({ auth, params }: HttpContext) {
    return new SecurityAuditsService().list(auth.getUserOrFail().id, params.projectId)
  }

  async update({ auth, params, request }: HttpContext) {
    const { audit } = await request.validateUsing(saveSecurityAuditValidator)
    return new SecurityAuditsService().save(
      auth.getUserOrFail().id,
      params.projectId,
      params.auditId,
      audit
    )
  }
}
