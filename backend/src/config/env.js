import 'dotenv/config'

function asBoolean(value, fallback = false) {
  if (value === undefined) return fallback
  return value.toLowerCase() === 'true'
}

function asPositiveNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: asPositiveNumber(process.env.PORT, 3000),
  fptAiApiKey: process.env.FPT_AI_API_KEY?.trim() ?? '',
  identityImageHosts: (process.env.IDENTITY_IMAGE_ALLOWED_HOSTS ?? 'res.cloudinary.com').split(',').map(value => value.trim().toLowerCase()).filter(Boolean),
  database: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: asPositiveNumber(process.env.DB_PORT, 5432),
    name: process.env.DB_NAME ?? 'coolcare_db',
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
    ssl: asBoolean(process.env.DB_SSL),
  },
  jwtSecret: process.env.JWT_SECRET ?? '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
  googleClientId: process.env.GOOGLE_WEB_CLIENT_ID ?? '',
  resetTokenExpiresIn: process.env.RESET_TOKEN_EXPIRES_IN ?? '10m',
  otpExpiresMinutes: asPositiveNumber(process.env.OTP_EXPIRES_MINUTES, 10),
  emailVerificationOtpExpiresMinutes: asPositiveNumber(
    process.env.EMAIL_VERIFICATION_OTP_EXPIRES_MINUTES,
    10
  ),
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: asPositiveNumber(process.env.SMTP_PORT, 587),
    secure: asBoolean(process.env.SMTP_SECURE),
    user: process.env.SMTP_USER ?? '',
    password: process.env.SMTP_PASSWORD ?? '',
    from: process.env.SMTP_FROM ?? 'CoolCare <no-reply@coolcare.local>',
  },
})

export function validateRuntimeEnv() {
  const missing = []
  if (!env.database.password) missing.push('DB_PASSWORD')
  if (env.jwtSecret.length < 32) missing.push('JWT_SECRET (minimum 32 characters)')

  if (missing.length > 0) {
    throw new Error(`Missing or invalid environment configuration: ${missing.join(', ')}`)
  }
}
