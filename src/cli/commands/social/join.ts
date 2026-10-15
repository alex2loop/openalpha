import type { ParsedArgs } from '@/cli/parsing/args'
import type { CliApp } from '@/cli/types'
import type { Locale } from '@/core/types/locale'
import type { JoinOutcome } from '@/social/api'
import { type Command, createCommand } from '@/cli/command'
import { getEnv } from '@/cli/env'
import { usage } from '@/cli/error-output'
import { CLI_FLAG_DESCRIPTIONS } from '@/cli/metadata'
import { flagBool, flagString } from '@/cli/parsing/args'
import { hint, success } from '@/cli/ui/colors'
import { confirm, declined, defaultPrompt } from '@/cli/ui/prompt'
import { resolveCredential } from '@/core/security/credentials'
import { formatLongDuration } from '@/core/utils/duration'
import { stripControls, toSingleLine } from '@/core/utils/text'
import { parseDuration } from '@/core/utils/time'
import { t } from '@/i18n'
import { MIN_VISIT_INTERVAL_MS } from '@/social/api'

interface JoinRequest {
  readonly agent: string
  readonly network: string
  readonly publicName?: string
}

export const socialJoinCommand: Command = createCommand({
  name: 'join',
  summary: { key: 'cliHelp.socialJoinSummary' },
  spec: {
    positional: ['agent', 'network'],
    flags: {
      every: { type: 'string', describe: { key: 'cliHelp.flagSocialEvery' } },
      keyEnv: { type: 'string', describe: { key: 'cliHelp.flagSocialKeyEnv' } },
      name: { type: 'string', describe: { key: 'cliHelp.flagSocialPublicName' } },
      yes: { type: 'boolean', describe: CLI_FLAG_DESCRIPTIONS.skipConfirmation },
    },
  },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const agent = flagString(args, 'agent')
    const network = flagString(args, 'network')
    const every = flagString(args, 'every')
    const intervalMs = every === undefined ? undefined : parseEvery(every)

    if (agent === undefined || network === undefined) {
      return usage(app, t(locale, 'cli.socialJoinUsage'))
    }

    if (every !== undefined && intervalMs === undefined) {
      const minimum = formatLongDuration(locale, MIN_VISIT_INTERVAL_MS)

      return usage(app, t(locale, 'cli.socialEveryInvalid', { value: every, minimum }))
    }

    const keyEnv = flagString(args, 'keyEnv')
    const apiKey = keyEnv === undefined ? undefined : resolveCredential(getEnv(), keyEnv)

    if (keyEnv !== undefined && apiKey === undefined) {
      return usage(app, t(locale, 'cli.socialKeyEnvMissing', { name: keyEnv }))
    }

    const publicName = flagString(args, 'name')
    const request = { agent, network, ...(publicName === undefined ? {} : { publicName }) }

    if (apiKey === undefined && !(await confirmRegistration(app, args, request))) {
      return declined(app)
    }

    const outcome = await app.resolve('socialService').join(
      {
        agentId: agent,
        network,
        ...(intervalMs === undefined ? {} : { intervalMs }),
        ...(apiKey === undefined ? {} : { apiKey }),
        ...(publicName === undefined ? {} : { publicName }),
      },
      app.signal
    )

    printJoined(app, { request, outcome, ...(keyEnv === undefined ? {} : { keyEnv }) })

    return 0
  },
})

/** `undefined` for anything that is not a duration of at least the minimum. */
function parseEvery(raw: string): number | undefined {
  const parsed = parseDuration(raw)

  return parsed?.kind === 'value' && parsed.ms >= MIN_VISIT_INTERVAL_MS ? parsed.ms : undefined
}

/** What goes out in public under the agent's name is read before it is sent. */
async function confirmRegistration(
  app: CliApp,
  args: ParsedArgs,
  request: JoinRequest
): Promise<boolean> {
  const locale = app.config.locale.language
  const body = await app.resolve('socialService').previewRegistration({
    agentId: request.agent,
    network: request.network,
    ...(request.publicName === undefined ? {} : { publicName: request.publicName }),
  })

  for (const line of registrationLines(locale, { network: request.network, body })) {
    app.out(line)
  }

  const asked = t(locale, 'cli.socialRegisterConfirm', { network: request.network })

  return flagBool(args, 'yes') || (await confirm(defaultPrompt(), asked, locale))
}

function registrationLines(
  locale: Locale,
  input: { readonly network: string; readonly body: Readonly<Record<string, string>> | undefined }
): readonly string[] {
  const fields = Object.entries(input.body ?? {}).map(
    ([key, value]) => `  ${toSingleLine(stripControls(key))}: ${toSingleLine(stripControls(value))}`
  )

  return [t(locale, 'cli.socialRegisterPreview', { network: input.network }), ...fields]
}

function printJoined(
  app: CliApp,
  joined: { readonly request: JoinRequest; readonly outcome: JoinOutcome; readonly keyEnv?: string }
): void {
  const locale = app.config.locale.language
  const { request, outcome } = joined

  app.out(
    success(t(locale, 'cli.socialJoined', { agent: request.agent, network: request.network }))
  )

  for (const claim of outcome.claims) {
    app.out(
      t(locale, 'cli.socialClaimLine', {
        field: toSingleLine(stripControls(claim.field)),
        value: toSingleLine(stripControls(claim.value)),
      })
    )
  }

  if (outcome.claims.length > 0) {
    app.out(hint(t(locale, 'cli.socialClaimHint')))
  }

  app.out(hint(t(locale, 'cli.socialKeyBackup', { path: outcome.keyPath })))

  if (joined.keyEnv !== undefined) {
    app.out(hint(t(locale, 'cli.socialKeyEnvOnce', { name: joined.keyEnv })))
  }
}
