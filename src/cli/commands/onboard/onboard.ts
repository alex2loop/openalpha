import type { Needs } from '@/cli/command'
import type { CliApp } from '@/cli/types'
import { type Command, createCommand } from '@/cli/command'
import { isInteractiveStdin } from '@/cli/env'
import { terminalErrorMessage } from '@/cli/error-output'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'
import { fail, hint, info, style, success } from '@/cli/ui/colors'
import { confirmDefaultYes, declined, multiPrompt } from '@/cli/ui/prompt'
import { BRAND } from '@/core/brand'
import { probeConfig } from '@/core/config/load'
import { isAbortError } from '@/core/errors'
import { t } from '@/i18n'

import type { AskContext } from './ask'
import { finishModelChange } from './check'
import {
  isConfigPresent,
  STARTER_DAILY_BUDGET_USD,
  starterConfigToml,
  writeStarterConfig,
} from './config-file'
import { editExistingConfig } from './edit'
import { askModel } from './model-step'
import { askBudget, askLanguage, askTelegram, shellLocale } from './settings-step'

const EXIT_BLOCKED = 1

// No-boot lane: it writes the very config the other commands need, so it cannot require one. An
// explicit --config that does not exist yet is the file it is asked to create.
export const onboardCommand: Command = createCommand({
  ...CLI_COMMAND_METADATA.onboard,
  needs: { boot: false, configFile: 'probe' },
  run: (_args, app) => runOnboard(app),
})

/** A first run with no config: offer the setup in place, so the next step is one keypress.
 *  Undefined lets the command run as usual: a config exists, `--config` named one, or the command
 *  does not need one. */
export async function offerOnboard(
  app: CliApp,
  invocation: { readonly argv: readonly string[]; readonly needs: Required<Needs> }
): Promise<number | undefined> {
  const probe = app.configProbe
  const bare = invocation.argv.length === 0

  if (probe?.configMissing !== true || probe.explicitConfig) {
    return undefined
  }

  if (!bare && invocation.needs.configFile !== 'required') {
    return undefined
  }

  if (!isInteractiveStdin()) {
    return bare ? undefined : missingConfig(app, probe.configPath)
  }

  return (await askToOnboard(app)) ? runOnboard(app) : missingConfig(app, probe.configPath)
}

async function runOnboard(app: CliApp): Promise<number> {
  // With no config there is no `[locale]` yet, so a first setup speaks the shell's language.
  const locale =
    app.configProbe?.configMissing === false ? app.config.locale.language : shellLocale()

  // A wizard with nobody to answer it would take every default and write a config the operator
  // never saw. Say so instead of exiting 0 having done nothing.
  if (!isInteractiveStdin()) {
    app.err(fail(t(locale, 'cli.onboardNeedsTerminal')))
    app.err(hint(t(locale, 'cli.onboardManualHint', { brand: BRAND.name })))

    return EXIT_BLOCKED
  }

  const configPath = app.configProbe?.configPath ?? (await probeConfig()).configPath
  const { prompt, close } = multiPrompt()
  const ctx: AskContext = { app, prompt, locale }

  try {
    return (await isConfigPresent(configPath))
      ? await editExistingConfig(ctx, configPath)
      : await firstSetup(ctx, configPath)
  } catch (err: unknown) {
    // Ctrl-D or a closed terminal mid-wizard: nothing was written, so it is a decline.
    if (!isAbortError(err)) {
      app.err(fail(terminalErrorMessage(err, locale)))

      return EXIT_BLOCKED
    }

    return declined(app, locale)
  } finally {
    close()
  }
}

async function firstSetup(shellCtx: AskContext, configPath: string): Promise<number> {
  shellCtx.app.out(
    style.title(t(shellCtx.locale, 'cli.onboardSetupTitle', { brand: BRAND.display }))
  )
  shellCtx.app.out(hint(t(shellCtx.locale, 'cli.onboardWritesTo', { path: configPath })))

  const language = await askLanguage(shellCtx)
  const ctx: AskContext = { ...shellCtx, locale: language }
  const chosen = await askModel(ctx)
  const dailyBudgetUsd = await askBudget(ctx, STARTER_DAILY_BUDGET_USD)
  const telegramTokenEnv = await askTelegram(ctx)
  const telegram = telegramTokenEnv === undefined ? {} : { telegramTokenEnv }
  const content = starterConfigToml(
    { model: chosen.starter, language, dailyBudgetUsd, ...telegram },
    { api: false }
  )

  ctx.app.out('')
  ctx.app.out(info(t(ctx.locale, 'cli.onboardAboutToWrite')))
  ctx.app.out(content)

  if (!(await confirmDefaultYes(ctx.prompt, t(ctx.locale, 'cli.onboardWriteConfirm'), language))) {
    return declined(ctx.app, language)
  }

  await writeStarterConfig(configPath, content)
  ctx.app.out(success(t(ctx.locale, 'cli.onboardWrote', { path: configPath })))
  await finishModelChange(ctx, { chosen, configPath, firstRun: true, ...telegram })

  return 0
}

async function askToOnboard(app: CliApp): Promise<boolean> {
  const locale = shellLocale()
  const { prompt, close } = multiPrompt()

  app.out(info(t(locale, 'cli.onboardFirstRun', { brand: BRAND.display })))

  try {
    return await confirmDefaultYes(prompt, t(locale, 'cli.onboardPromptStart'), locale)
  } catch (err: unknown) {
    if (isAbortError(err)) {
      return false
    }

    throw err
  } finally {
    close()
  }
}

function missingConfig(app: CliApp, configPath: string): number {
  const params = { path: configPath, brand: BRAND.name }

  app.err(fail(t(shellLocale(), 'errors.configFileMissing', params)))

  return EXIT_BLOCKED
}
