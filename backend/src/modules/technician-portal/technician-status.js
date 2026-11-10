// PostgreSQL stores status as smallint; the API adapter may return enum labels.
// Accept either representation without relaxing authorization requirements.
export const isVerifiedTechnician = (value) => value === 'VERIFIED' || value === 1 || value === '1'
export const isActiveAccount = (value) => value === 'ACTIVE' || value === 0 || value === '0'
