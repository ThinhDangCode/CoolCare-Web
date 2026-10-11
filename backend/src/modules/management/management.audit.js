export function writeManagementAudit({ actorId, action, entityType, entityId, before, after }) {
  // The existing schema has no general audit table. Emit one structured event for the
  // deployment logger without persisting credentials or other sensitive user fields.
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
