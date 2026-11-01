import type { Locale } from '@/core/types/locale'
import { getEnv } from '@/cli/env'
import { hint } from '@/cli/ui/colors'
import { confirm } from '@/cli/ui/prompt'
import { CURRENCY_CODE_PATTERN } from '@/core/config/resolve'
import { LOCALES } from '@/core/types/locale'
import { t } from '@/i18n'

import { type AskContext, accept, askChoice, askUntilValid, indexOrLast, refuse } from './ask'
import { parseEnvName } from './model-step'

const TELEGRAM_TOKEN_ENV = 'TELEGRAM_BOT_TOKEN'
const LANGUAGE_NAME_KEYS = {
  en: 'cli.onboardLanguageEn',
  vi: 'cli.onboardLanguageVi',
} as const satisfies Record<Locale, string>
const CURRENCY_CHOICES = ['VND', 'USD'] as const
const SEC_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const SEC_CONTACT_ENV = 'SEC_CONTACT_EMAIL'

/** The market a book is mainly held in; it sets the home region and the book's currency. */
export type HomeRegion = 'vn' | 'us'

const HOME_MARKETS = [
  { region: 'vn', currency: 'VND', label: 'cli.onboardHomeMarketVn' },
  { region: 'us', currency: 'USD', label: 'cli.onboardHomeMarketUs' },
] as const satisfies readonly {
  readonly region: HomeRegion
  readonly currency: string
  readonly label: string
}[]
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

export function isHomeRegion(value: string): value is HomeRegion {
  return HOME_MARKETS.some((market) => market.region === value)
}

export function homeCurrencyOf(region: HomeRegion): string {
  return HOME_MARKETS.find((market) => market.region === region)?.currency ?? CURRENCY_CHOICES[0]
}

/** Which market the operator mainly trades: the answer the home region and the currency default
 *  both follow, so a US operator is not asked to start from VND. */
export async function askHomeMarket(ctx: AskContext, previous?: HomeRegion): Promise<HomeRegion> {
  return await askChoice(ctx, {
    question: t(ctx.locale, 'cli.onboardPromptHomeMarket'),
    choices: HOME_MARKETS.map((market) => ({
      label: t(ctx.locale, market.label),
      value: market.region,
    })),
    defaultIndex: Math.max(
      HOME_MARKETS.findIndex((market) => market.region === previous),
      0
    ),
  })
}

/** SEC asks every reader for a contact; it is read back as a line, not a secret, so the prompt
 *  shows what is typed. Empty skips and turns US accounts off. */
export async function askSecContact(ctx: AskContext): Promise<string | undefined> {
  ctx.app.out(t(ctx.locale, 'cli.onboardSecEmailIntro'))

  return await askUntilValid(ctx, t(ctx.locale, 'cli.onboardPromptSecEmail'), (answer) => {
    const email = answer.trim()

    if (email === '') {
      return accept<string | undefined>(undefined)
    }

    return SEC_EMAIL_RE.test(email)
      ? accept<string | undefined>(email)
      : refuse(t(ctx.locale, 'cli.onboardSecEmailInvalid'))
  })
}

/** The book's currency is fixed by the first saved profile, and nothing before onboard asks, so a USD
 *  user would lock into VND before touching config. VND leads; another 3-letter code may be typed. */
export async function askCurrency(ctx: AskContext, previous?: string): Promise<string> {
  const listed: readonly string[] = CURRENCY_CHOICES

  const picked = await askChoice<string | undefined>(ctx, {
    question: t(ctx.locale, 'cli.onboardCurrencyQuestion'),
    choices: [
      ...CURRENCY_CHOICES.map((code) => ({ label: code, value: code })),
      { label: t(ctx.locale, 'cli.onboardCurrencyOther'), value: undefined },
    ],
    defaultIndex: previous === undefined ? 0 : indexOrLast(listed.indexOf(previous), listed),
  })

  return (
    picked ??
    (await askUntilValid(ctx, t(ctx.locale, 'cli.onboardPromptCurrencyCode'), (answer) => {
      const code = answer.trim().toUpperCase()

      return CURRENCY_CODE_PATTERN.test(code)
        ? accept(code)
        : refuse(t(ctx.locale, 'cli.onboardCurrencyInvalid'))
    }))
  )
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
