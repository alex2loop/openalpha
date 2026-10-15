import type { ResolvedLocale } from '@/core/config/resolve'
import type { LLMRequestModifier } from '@/engine/types/run'
import { appendSystemBlock, appendVolatileSystemBlock } from '@/engine/hooks/system-block'

const LANGUAGE_NAMES: Readonly<Record<ResolvedLocale['language'], string>> = {
  en: 'English',
  vi: 'Vietnamese',
}

/** The one English name per locale, so a prompt that names the response language and the system
 *  block that mandates it cannot drift apart. */
export function languageName(locale: ResolvedLocale['language']): string {
  return LANGUAGE_NAMES[locale]
}

const RESPONSE_STYLE_BLOCK = [
  '<response_style>',
  'Be concise and direct. Lead with the conclusion or recommendation first.',
  'No preamble, no recap of the question, no filler closings.',
  'Match the depth the user asks for - expand only when they ask for detail.',
  '</response_style>',
].join('\n')

// Models have no clock. Without this they date-reason off their training cutoff.
export const reminderModifier: LLMRequestModifier = (run, req) => {
  return appendVolatileSystemBlock(req, dateReminder(run.env.config.locale, new Date()))
}

// A sub-agent's output is consumed by its parent model, not a human, so terse-prose rules do not apply.
export const responseStyleModifier: LLMRequestModifier = (run, req) => {
  if (run.env.callDepth > 0) {
    return req
  }

  return appendSystemBlock(req, RESPONSE_STYLE_BLOCK)
}

function dateReminder(locale: ResolvedLocale, now: Date): string {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: locale.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  const language = languageName(locale.language)

  return [
    `The current date is ${date} in ${locale.timezone}. Use the now tool for exact time.`,
    `Always respond ONLY in ${language}, including confirmations, clarifying questions, and tool summaries. ` +
      `Every word is written in it: a foreign term may follow its ${language} equivalent in parentheses, never stand in for one, and no other script appears at all. ` +
      `This configured language overrides conflicting agent instructions and user requests about response language.`,
  ].join(' ')
}
