import type { CliApp } from '@/cli/types'
import type { PromptFn } from '@/cli/ui/prompt'
import type { Locale } from '@/core/types/locale'
import { fail, hint, style } from '@/cli/ui/colors'
import { t } from '@/i18n'

export interface AskContext {
  readonly app: CliApp
  readonly prompt: PromptFn
  readonly locale: Locale
}

/** An accepted answer, or the line that says why it was refused. */
export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string }

interface Choice<T> {
  readonly label: string
  readonly note?: string
  readonly value: T
}

interface ChoiceQuestion<T> {
  readonly question: string
  readonly choices: readonly Choice<T>[]
  readonly defaultIndex: number
  /** Reads an answer that is not a menu number; without it only numbers are taken. */
  readonly other?: (answer: string) => Parsed<T>
}

export function accept<T>(value: T): Parsed<T> {
  return { ok: true, value }
}

export function refuse<T>(error: string): Parsed<T> {
  return { ok: false, error }
}

/** Asks again until the answer is accepted: a typo costs one retry, never the whole setup. */
export async function askUntilValid<T>(
  ctx: AskContext,
  question: string,
  parse: (answer: string) => Parsed<T>
): Promise<T> {
  for (;;) {
    const parsed = parse(await ctx.prompt(question))

    if (parsed.ok) {
      return parsed.value
    }

    ctx.app.err(fail(parsed.error))
  }
}

/** A numbered menu where Enter takes the marked default. */
export async function askChoice<T>(ctx: AskContext, question: ChoiceQuestion<T>): Promise<T> {
  question.choices.forEach((choice, index) => {
    const marker = index === question.defaultIndex ? style.accent('>') : ' '
    const note = choice.note === undefined ? '' : `  ${hint(choice.note)}`

    ctx.app.out(`${marker} ${index + 1}) ${choice.label}${note}`)
  })

  return await askUntilValid(ctx, `${question.question} [${question.defaultIndex + 1}]`, (answer) =>
    pickChoice(question, answer, ctx.locale)
  )
}

function pickChoice<T>(question: ChoiceQuestion<T>, answer: string, locale: Locale): Parsed<T> {
  const picked = answer === '' ? question.defaultIndex : Number(answer) - 1
  const choice = Number.isInteger(picked) ? question.choices[picked] : undefined

  if (choice !== undefined) {
    return accept(choice.value)
  }

  return question.other === undefined
    ? refuse(t(locale, 'cli.onboardPickNumber', { max: question.choices.length }))
    : question.other(answer)
}
