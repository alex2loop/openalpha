import type { ProviderEntry } from '@/ai/api'
import type { Locale } from '@/core/types/locale'
import { ValidationError } from '@/core/errors'

import type { ModelAnswer } from './model-step'
import { type AskContext, StepBack } from './ask'
import { askModelFor, askProvider } from './model-step'
import { askCurrency, askLanguage } from './settings-step'

interface ModelAnswers {
  readonly provider?: ProviderEntry
  readonly chosen?: ModelAnswer
}

interface FirstAnswers extends ModelAnswers {
  readonly language: Locale
  readonly currency?: string
}

type ListStep<A> = (ctx: AskContext, answers: A) => Promise<A>

interface StepRun<A> {
  readonly steps: readonly ListStep<A>[]
  readonly answers: A
  /** The language later steps speak, when an earlier step asked it. */
  readonly localeOf?: (answers: A) => Locale
}

/** The first setup's list questions: language, currency, provider and model. */
export async function askFirstAnswers(
  ctx: AskContext
): Promise<{ readonly language: Locale; readonly currency: string; readonly chosen: ModelAnswer }> {
  const answers = await runListSteps<FirstAnswers>(ctx, {
    steps: [askLanguageStep, askCurrencyStep, askProviderStep, askModelStep],
    answers: { language: ctx.locale },
    localeOf: (asked) => asked.language,
  })

  if (answers.currency === undefined) {
    throw new ValidationError('onboard list questions ended without a currency')
  }

  return { language: answers.language, currency: answers.currency, chosen: chosenOf(answers) }
}

/** Provider then model, as the config edit asks them. */
export async function askModelAnswer(ctx: AskContext): Promise<ModelAnswer> {
  return chosenOf(
    await runListSteps<ModelAnswers>(ctx, { steps: [askProviderStep, askModelStep], answers: {} })
  )
}

/** Asks the steps in order. Left on a step asks the one before it again, its earlier answer marked;
 *  on the first step it is offered only when the caller's context allows going back, and then the
 *  StepBack reaches the caller. */
async function runListSteps<A>(ctx: AskContext, run: StepRun<A>): Promise<A> {
  let answers = run.answers
  let step = 0

  while (step < run.steps.length) {
    const ask = run.steps[step]

    if (ask === undefined) {
      break
    }

    const canGoBack = step > 0 || ctx.canGoBack === true
    const locale = run.localeOf?.(answers) ?? ctx.locale

    try {
      answers = await ask({ ...ctx, locale, ...(canGoBack ? { canGoBack: true } : {}) }, answers)
      step += 1
    } catch (err: unknown) {
      if (!(err instanceof StepBack) || step === 0) {
        throw err
      }

      step -= 1
    }
  }

  return answers
}

async function askLanguageStep(ctx: AskContext, answers: FirstAnswers): Promise<FirstAnswers> {
  return { ...answers, language: await askLanguage(ctx) }
}

async function askCurrencyStep(ctx: AskContext, answers: FirstAnswers): Promise<FirstAnswers> {
  return { ...answers, currency: await askCurrency(ctx, answers.currency) }
}

async function askProviderStep<A extends ModelAnswers>(ctx: AskContext, answers: A): Promise<A> {
  return { ...answers, provider: await askProvider(ctx, answers.provider) }
}

async function askModelStep<A extends ModelAnswers>(ctx: AskContext, answers: A): Promise<A> {
  const provider = answers.provider ?? (await askProvider(ctx))

  return { ...answers, provider, chosen: await askModelFor(ctx, provider, answers.chosen) }
}

// Every step has answered once the steps end; this only narrows the type.
function chosenOf(answers: ModelAnswers): ModelAnswer {
  if (answers.chosen === undefined) {
    throw new ValidationError('onboard list questions ended without a model')
  }

  return answers.chosen
}
