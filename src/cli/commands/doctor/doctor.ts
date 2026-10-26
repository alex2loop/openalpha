import type { CliApp } from '@/cli/types'
import type { CheckName } from '@/core/types/doctor'
import type { Locale } from '@/core/types/locale'
import { type Command, createCommand, hasConfigError } from '@/cli/command'
import { getEnv, isQuiet } from '@/cli/env'
import { terminalErrorMessage, usage } from '@/cli/error-output'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'
import { fail, success } from '@/cli/ui/colors'
import { probeConfig } from '@/core/config/load'
import { CHECK_NAMES } from '@/core/types/doctor'
import { pluralKey, t } from '@/i18n'

import type { DoctorInput, DoctorProbe } from './types'
import { type CheckRunner, createSharedChecks, isCheckName, runChecks } from './checks'
import { probeComposition } from './composition-probe'
import { checkLabel } from './labels'
import { probeDaemon, tradingConfigOf } from './local-probes'
import { labelWidthOf, renderDoctorProbe } from './render'

const EXIT_ISSUES_FOUND = 1

export const doctorCommand: Command = createCommand({
  ...CLI_COMMAND_METADATA.doctor,
  needs: { boot: false, configFile: 'probe' },
  spec: {
    positional: ['check'],
    positionalOptional: true,
    flags: {
      online: {
        type: 'boolean',
        describe: { key: 'cliHelp.flagDoctorOnline' },
      },
    },
  },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const selected = typeof args.check === 'string' ? args.check : undefined

    if (selected !== undefined && !isCheckName(selected)) {
      return usage(app, t(locale, 'cli.doctorCheckInvalid', { names: CHECK_NAMES.join(', ') }))
    }

    const probes = await runProbes(app, {
      online: args.online === true,
      ...(selected === undefined ? {} : { selected }),
    })
    const quiet = isQuiet()
    const visible = quiet ? probes.filter((probe) => probe.status === 'fail') : probes

    const labelWidth = labelWidthOf(visible)

    for (const probe of visible) {
      app.out(renderDoctorProbe(probe, labelWidth))
    }

    const failed = probes.filter((probe) => probe.status === 'fail')

    if (quiet) {
      return failed.length === 0 ? 0 : EXIT_ISSUES_FOUND
    }

    app.out('')

    if (failed.length === 0) {
      app.out(success(t(locale, 'cli.doctorNoProblems')))

      return 0
    }

    app.err(
      fail(
        t(
          locale,
          pluralKey(failed.length, 'cli.doctorProblemsFoundOne', 'cli.doctorProblemsFound'),
          { count: failed.length }
        )
      )
    )

    return EXIT_ISSUES_FOUND
  },
})

async function runProbes(
  app: CliApp,
  options: { readonly online: boolean; readonly selected?: CheckName }
): Promise<readonly DoctorProbe[]> {
  const locale = app.config.locale.language
  const input: DoctorInput = {
    config: app.config,
    env: getEnv(),
    locale,
    online: options.online,
    onlineExcept: new Set(),
    surface: 'terminal',
  }
  const checks = createCheckRegistry(app, input)
  const names = options.selected === undefined ? CHECK_NAMES : [options.selected]

  return await runChecks(
    names.map((name) => [name, checks[name]]),
    locale
  )
}

function createCheckRegistry(
  app: CliApp,
  input: DoctorInput
): Readonly<Record<CheckName, CheckRunner>> {
  const locale = input.locale
  // A config whose only fault is an unset key still loads: the key is reported under models.
  const configFailed = hasConfigError(app) && app.configProbe?.configKeyMissing !== true
  const trading = tradingConfigOf(input.config)
  const shared = createSharedChecks(input)
  const awaiting =
    (name: CheckName): CheckRunner =>
    async () =>
      awaitingConfig(name, locale)

  return {
    ...shared,
    config: async () => [await probeConfiguration(app, locale)],
    daemon: async () => [await probeDaemon(app)],
    trading:
      configFailed || trading === undefined
        ? awaiting('trading')
        : async () => [await probeComposition(app, locale)],
    ...(configFailed
      ? { models: awaiting('models'), safety: awaiting('safety'), providers: awaiting('providers') }
      : {}),
  }
}

function awaitingConfig(name: CheckName, locale: Locale): readonly DoctorProbe[] {
  return [
    {
      name: checkLabel(locale, name),
      status: 'warn',
      detail: t(locale, 'cli.doctorConfigNotLoaded'),
    },
  ]
}

async function probeConfiguration(app: CliApp, locale: Locale): Promise<DoctorProbe> {
  const name = checkLabel(locale, 'config')

  try {
    if (app.configProbe !== undefined) {
      const { configError, configKeyMissing, configPath } = app.configProbe

      return configError === null || configKeyMissing
        ? { name, status: 'ok', detail: configPath }
        : { name, status: 'fail', detail: configError }
    }

    const result = await probeConfig()

    return result.error === null
      ? { name, status: 'ok', detail: result.configPath }
      : { name, status: 'fail', detail: terminalErrorMessage(result.error, locale) }
  } catch {
    return { name, status: 'fail', detail: t(locale, 'cli.doctorCannotBeInspected') }
  }
}
