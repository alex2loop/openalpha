import { z } from 'zod'

import type { ResolvedConfig } from '@/core/config/resolve'
import type { Locale } from '@/core/types/locale'
import {
  parseZaloPersonalConfig,
  readZaloPersonalCredentials,
  resolveSecret,
  type ZaloPersonalBlocker,
  type ZaloPersonalChannelConfig,
  zaloPersonalBlocker,
} from '@/channels/api'
import { BRAND } from '@/core/brand'
import { setEnvCommand } from '@/core/config/resolve'
import { type MessageKey, t } from '@/i18n'

import type { DoctorEnvironment, DoctorProbe } from './types'
import { checkLabel, subjectLabel } from './labels'

const TOKEN_CREDENTIAL_CHANNELS: ReadonlySet<string> = new Set(['telegram', 'zalo'])
const ZALO_PERSONAL_CHANNEL = 'zalo_personal'
const ZALO_PERSONAL_BLOCKER_KEYS = {
  disabled: 'cli.doctorChannelDisabled',
  ban_risk_not_accepted: 'cli.doctorZaloPersonalRiskNotAccepted',
  no_allowed_ids: 'cli.doctorZaloPersonalNoAllowedIds',
} as const satisfies Record<ZaloPersonalBlocker, MessageKey>

const channelConfigSchema = z.looseObject({
  enabled: z.boolean().optional(),
  token_env: z.string().optional(),
  token_file: z.string().optional(),
  dm_policy: z.enum(['pairing', 'allowlist', 'disabled']).optional(),
})

const addressingSchema = z.looseObject({
  enabled: z.boolean().optional(),
  allowed_ids: z.array(z.union([z.string(), z.number()])).optional(),
  fallback_chat_id: z.string().optional(),
})

export async function probeChannels(
  config: ResolvedConfig,
  env: DoctorEnvironment,
  locale: Locale
): Promise<readonly DoctorProbe[]> {
  const entries = Object.entries(config.channels)

  if (entries.length === 0) {
    return [
      {
        name: checkLabel(locale, 'channels'),
        status: 'ok',
        detail: t(locale, 'cli.doctorChannelsNoneConfigured'),
      },
    ]
  }

  return await Promise.all(
    entries.map(([channel, raw]) =>
      channel === ZALO_PERSONAL_CHANNEL
        ? probeZaloPersonal({ raw, dataDir: config.paths.dataDir, locale })
        : probeChannel({ channel, raw, env, locale })
    )
  )
}

// Zalo Personal has no token: it needs the ban-risk opt-in, an allowlist and a saved QR login, and
// the daemon only logs which one is missing.
async function probeZaloPersonal(options: {
  readonly raw: unknown
  readonly dataDir: string
  readonly locale: Locale
}): Promise<DoctorProbe> {
  const { locale } = options
  const name = subjectLabel(locale, 'channel', ZALO_PERSONAL_CHANNEL)
  let config: ZaloPersonalChannelConfig

  try {
    config = parseZaloPersonalConfig(options.raw)
  } catch {
    return { name, status: 'fail', detail: t(locale, 'cli.doctorChannelInvalidConfig') }
  }

  const blocker = zaloPersonalBlocker(config)

  if (blocker !== undefined) {
    return { name, status: 'warn', detail: t(locale, ZALO_PERSONAL_BLOCKER_KEYS[blocker]) }
  }

  const credentials = await readZaloPersonalCredentials({
    dataDir: options.dataDir,
    profile: config.profile,
  })

  if (credentials === undefined) {
    return {
      name,
      status: 'fail',
      detail: t(locale, 'cli.doctorZaloPersonalNotLinked', {
        profile: config.profile,
        brand: BRAND.name,
      }),
    }
  }

  return { name, status: 'ok', detail: t(locale, 'cli.doctorChannelEnabled') }
}

function probeChannel(options: {
  readonly channel: string
  readonly raw: unknown
  readonly env: DoctorEnvironment
  readonly locale: Locale
}): DoctorProbe {
  const parsed = channelConfigSchema.safeParse(options.raw)
  const name = subjectLabel(options.locale, 'channel', options.channel)

  if (!parsed.success) {
    return {
      name,
      status: 'fail',
      detail: t(options.locale, 'cli.doctorChannelInvalidConfig'),
    }
  }

  const data = parsed.data

  if (data.enabled === false) {
    return {
      name,
      status: 'warn',
      detail: t(options.locale, 'cli.doctorChannelDisabled'),
    }
  }

  const hasTokenConfig = data.token_env !== undefined || data.token_file !== undefined

  if (TOKEN_CREDENTIAL_CHANNELS.has(options.channel) || hasTokenConfig) {
    const token = resolveSecret(data, options.env)

    if (token === '') {
      return {
        name,
        status: 'fail',
        detail: doctorTokenDetail(options.locale, data.token_env),
      }
    }
  }

  return {
    name,
    status: 'ok',
    detail: t(options.locale, 'cli.doctorChannelEnabled'),
  }
}

function doctorTokenDetail(locale: Locale, tokenEnv: string | undefined): string {
  if (tokenEnv === undefined) {
    return t(locale, 'cli.doctorTokenNotResolved', { brand: BRAND.name })
  }

  return t(locale, 'cli.doctorTokenEnvEmpty', { env: tokenEnv, command: setEnvCommand(tokenEnv) })
}

export function probeDeliveryAddressing(config: ResolvedConfig, locale: Locale): DoctorProbe {
  const ambiguous: string[] = []

  for (const [channel, raw] of Object.entries(config.channels)) {
    const parsed = addressingSchema.safeParse(raw)

    if (!parsed.success || parsed.data.enabled === false) {
      continue
    }

    const { allowed_ids, fallback_chat_id } = parsed.data

    if (fallback_chat_id === undefined && (allowed_ids?.length ?? 0) > 1) {
      ambiguous.push(`${channel} (${allowed_ids?.length} allowed ids)`)
    }
  }

  if (ambiguous.length === 0) {
    return {
      name: checkLabel(locale, 'delivery'),
      status: 'ok',
      detail: t(locale, 'cli.doctorDeliveryAddressed'),
    }
  }

  return {
    name: checkLabel(locale, 'delivery'),
    status: 'warn',
    detail: t(locale, 'cli.doctorDeliveryAmbiguous', { channels: ambiguous.join(', ') }),
  }
}
