import type { CliApp } from '@/cli/types'
import type { PromptFn } from '@/cli/ui/prompt'
import type { SelectOption } from '@/cli/ui/select'
import type { Locale } from '@/core/types/locale'
import { fail, hint, style } from '@/cli/ui/colors'
import { isInteractiveTerminal } from '@/cli/ui/ghost-prompt'
import { MENU_MARKER, selectOption } from '@/cli/ui/select'
import { AppError } from '@/core/errors'
import { t } from '@/i18n'

export interface AskContext {
  readonly app: CliApp
  readonly prompt: PromptFn
  readonly locale: Locale
  /** A list question may go back to the one before it, which the caller asks again. */
  readonly canGoBack?: true
}

/** An accepted answer, or the line that says why it was refused. */
export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string }

interface Choice<T> extends SelectOption {
  readonly value: T
}

interface ChoiceQuestion<T> {
  readonly question: string
  readonly choices: readonly Choice<T>[]
  readonly defaultIndex: number
}

/** Left on a list question: the caller asks the question before it again. */
export class StepBack extends AppError {
  readonly code = 'onboard.step_back'
}

/** Where a previous answer sits in a list whose last line is "another...": off the list, it was
 *  typed on that last line. */
export function indexOrLast(index: number, listed: readonly unknown[]): number {
  return index === -1 ? listed.length : index
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

/** A menu picked with the arrow keys in a terminal; a numbered menu answered by typing
 *  where there is none (a pipe, CI). Enter takes the marked default either way. */
export async function askChoice<T>(ctx: AskContext, question: ChoiceQuestion<T>): Promise<T> {
  if (!isInteractiveTerminal()) {
    return await askNumbered(ctx, question)
  }

  const picked = await selectOption({
    question: question.question,
    hint: t(ctx.locale, ctx.canGoBack ? 'cli.onboardSelectHintBack' : 'cli.onboardSelectHint'),
    options: question.choices,
    selected: question.defaultIndex,
    ...(ctx.canGoBack ? { back: true } : {}),
  })

  if (picked === undefined) {
    throw new StepBack('the operator went back to the previous question')
  }

  return picked.value
}

async function askNumbered<T>(ctx: AskContext, question: ChoiceQuestion<T>): Promise<T> {
  question.choices.forEach((choice, index) => {
    const marker = index === question.defaultIndex ? style.accent(MENU_MARKER) : ' '
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

  return choice === undefined
    ? refuse(t(locale, 'cli.onboardPickNumber', { max: question.choices.length }))
    : accept(choice.value)
}
