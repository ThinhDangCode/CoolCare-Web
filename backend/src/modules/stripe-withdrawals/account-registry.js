import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { stripe } from './stripe.js'

// Single backend process only.
// Persist and back up data/stripe-accounts.json.
const filename = resolve(
  process.env.STRIPE_ACCOUNT_REGISTRY_FILE ||
  'data/stripe-accounts.json'
)

let queue = Promise.resolve()

function serialized(fn) {
  const run = queue.then(fn)
  queue = run.catch(() => {})
  return run
}

async function readRegistry() {
  try {
    const value = JSON.parse(
      await readFile(filename, 'utf8')
    )

    if (
      !value ||
      Array.isArray(value) ||
      typeof value !== 'object'
    ) {
      throw new Error('Invalid Stripe registry')
    }

    return value
  } catch (e) {
    if (e.code === 'ENOENT') return {}
    throw e
  }
}

async function saveRegistry(registry) {
  await mkdir(dirname(filename), {
    recursive: true,
    mode: 0o700,
  })

  const temp = `${filename}.${process.pid}.tmp`

  await writeFile(
    temp,
    JSON.stringify(registry, null, 2),
    { mode: 0o600 }
  )

  await rename(temp, filename)
}

export async function getAccount(technicianId) {
  const registry = await readRegistry()
  return registry[technicianId] || null
}

export async function ensureAccount(technicianId, contactEmail) {
  if (
    typeof technicianId !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(technicianId)
  ) {
    throw new Error('Invalid technician ID')
  }

  if (typeof contactEmail !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(contactEmail.trim())) {
    throw new Error('Technician email is required to create a Stripe account')
  }

  return serialized(async () => {
    const registry = await readRegistry()

    // Reuse the existing account.
    if (registry[technicianId]) {
      return registry[technicianId]
    }

    const country = (
      process.env.STRIPE_CONNECTED_COUNTRY || 'US'
    ).toLowerCase()

    // Stripe Accounts v2.
    // Recipient accounts: fees and losses are handled by the platform.
    const account = await stripe(
      'core/accounts',
      {
        dashboard: 'express',
        contact_email: contactEmail.trim(),

        identity: {
          country,
          entity_type: 'individual',
        },

        configuration: {
          recipient: {
            capabilities: {
              stripe_balance: {
                stripe_transfers: {
                  requested: true,
                },
              },
            },
          },
        },

        defaults: {
          currency: 'usd',

          responsibilities: {
            fees_collector: 'application',
            // Transfers to recipient accounts require the platform to be the losses
            // collector. The platform must accept loss liability once in
            // Dashboard > Connect > Platform profile.
            losses_collector: 'application',
          },
        },

        metadata: {
          coolcare_technician_id: technicianId,
        },
      },
      {
        version: 'v2',
        idempotencyKey:
          `coolcare-v2-recipient-r4-${technicianId}`,
      }
    )

    if (!account.id?.startsWith('acct_')) {
      throw new Error(
        'Stripe did not return connected account ID'
      )
    }

    const alreadyMapped = Object.entries(
      registry
    ).some(
      ([id, acct]) =>
        id !== technicianId && acct === account.id
    )

    if (alreadyMapped) {
      throw new Error(
        'Stripe account already mapped to another technician'
      )
    }

    registry[technicianId] = account.id

    await saveRegistry(registry)

    return account.id
  })
}

export async function accountState(id) {
  const account = await stripe(
    `core/accounts/${encodeURIComponent(id)}`,
    null,
    {
      version: 'v2',
      method: 'GET',
      include: ['configuration.recipient'],
    }
  )

  const capability =
    account.configuration
      ?.recipient
      ?.capabilities
      ?.stripe_balance
      ?.stripe_transfers

  const transfersActive =
    capability?.status === 'active'

  return {
    ready: transfersActive,
    transfersActive,
    capabilityStatus:
      capability?.status || 'unknown',
  }
}