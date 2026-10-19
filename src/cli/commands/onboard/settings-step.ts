import type { Locale } from '@/core/types/locale'
import { getEnv } from '@/cli/env'
import { hint } from '@/cli/ui/colors'
import { confirm } from '@/cli/ui/prompt'
import { CURRENCY_CODE_PATTERN } from '@/core/config/resolve'
import { LOCALES } from '@/core/types/locale'
import { t } from '@/i18n'

import { type AskContext, accept, askChoice, askUntilValid, refuse } from './ask'
import { parseEnvName } from './model-step'

const TELEGRAM_TOKEN_ENV = 'TELEGRAM_BOT_TOKEN'
const LANGUAGE_NAME_KEYS = {
  en: 'cli.onboardLanguageEn',
  vi: 'cli.onboardLanguageVi',
} as const satisfies Record<Locale, string>
const CURRENCY_CHOICES = ['VND', 'USD'] as const
const VIETNAMESE_LOCALE_RE = /^vi/i

/** The shell's own language picks the default, as the installer does. */
export function shellLocale(): Locale {
  const env = getEnv()

  return VIETNAMESE_LOCALE_RE.test(env.LC_ALL || env.LANG || '') ? 'vi' : 'en'
}

export async function askLanguage(ctx: AskContext): Promise<Locale> {
  return await askChoice(ctx, {
    question: t(ctx.locale, 'cli.onboardPromptLanguage'),
    choices: LOCALES.map((locale) => ({
      label: t(locale, LANGUAGE_NAME_KEYS[locale]),
      value: locale,
    })),
    defaultIndex: LOCALES.indexOf(ctx.locale),
  })
}

/** The book's currency is fixed by the first saved profile, and nothing before onboard asks, so a USD
 *  user would lock into VND before touching config. VND leads; another 3-letter code may be typed. */
export async function askCurrency(ctx: AskContext): Promise<string> {
  return await askChoice<string>(ctx, {
    question: t(ctx.locale, 'cli.onboardCurrencyQuestion'),
    choices: CURRENCY_CHOICES.map((code) => ({ label: code, value: code })),
    defaultIndex: 0,
    other: (answer) => {
      const code = answer.trim().toUpperCase()

      return CURRENCY_CODE_PATTERN.test(code)
        ? accept(code)
        : refuse(t(ctx.locale, 'cli.onboardCurrencyInvalid'))
    },
  })
}

export async function askBudget(ctx: AskContext, current: number): Promise<number> {
  ctx.app.out(t(ctx.locale, 'cli.onboardBudgetIntro'))

  const question = `${t(ctx.locale, 'cli.onboardPromptBudget')} [${current}]`

  return await askUntilValid(ctx, question, (answer) => {
    const amount = answer === '' ? current : Number(answer)

    return Number.isFinite(amount) && amount >= 0
      ? accept(amount)
      : refuse(t(ctx.locale, 'cli.onboardBudgetInvalid'))
  })
}

/** The token stays in the environment: the config names its variable, never the token. */
export async function askTelegram(ctx: AskContext): Promise<string | undefined> {
  if (!(await confirm(ctx.prompt, t(ctx.locale, 'cli.onboardPromptTelegram'), ctx.locale))) {
    return undefined
  }

  return await askTelegramTokenEnv(ctx)
}

export async function askTelegramTokenEnv(ctx: AskContext): Promise<string> {
  ctx.app.out(hint(t(ctx.locale, 'cli.onboardTelegramIntro')))

  const question = `${t(ctx.locale, 'cli.onboardPromptTelegramEnv')} [${TELEGRAM_TOKEN_ENV}]`

  return await askUntilValid(ctx, question, (answer) =>
    parseEnvName(answer === '' ? TELEGRAM_TOKEN_ENV : answer, ctx.locale)
  )
}
