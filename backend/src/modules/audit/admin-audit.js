export function writeAdminAudit({ actorId, action, entityType, entityId, before, after }) {
  console.info(
    JSON.stringify({
      event: 'ADMIN_AUDIT',
      actorId,
      action,
      entityType,
      entityId,
      before,
      after,
      occurredAt: new Date().toISOString(),
    })
  )
}
