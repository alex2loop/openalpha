import { randomInt } from 'node:crypto'

import type { OutboundButton } from '@/channels/types'
import type { Locale } from '@/core/types/locale'
import { type LruMap, lruMap } from '@/core/utils/collections'
import { t } from '@/i18n'

const CHOICE_CODE_DIGITS = 4
const CHOICE_CODE_RE = new RegExp(`^/(\\d{${CHOICE_CODE_DIGITS}})$`)
const CHOICE_CODE_SPACE = 10 ** CHOICE_CODE_DIGITS
const CHOICE_DRAWS = 10
const MAX_CHOICES = 1_024
const COMMAND_PREFIX = '/'

interface ChoiceEntry {
  readonly callbackId: string
  readonly expiresAt: number
}

/** An `expired` code is kept so it is still told apart from text that was never a code. */
type ChoiceLookup =
  | { readonly kind: 'live'; readonly callbackId: string }
  | { readonly kind: 'expired' }

interface ChoiceOffer {
  readonly chatId: string
  readonly buttons: readonly OutboundButton[]
  readonly expiresAt: number
}

/** Buttons for a chat that has none: each choice is a short code the operator types back. */
export interface TextChoices {
  /** One typed code per button, as ready-to-send lines; empty when no free code could be drawn. */
  offer(input: ChoiceOffer): readonly string[]
  isCode(text: string): boolean
  /** What a code this chat was handed stands for; undefined for one it never was. */
  lookup(chatId: string, text: string): ChoiceLookup | undefined
}

/** One per channel pipeline, shared by approvals and plan reviews so two prompts open in one chat
 *  never mint the same code. Nothing consumes a code: its prompt answers a repeat. */
export function createTextChoices(locale: Locale): TextChoices {
  const entries = lruMap<string, ChoiceEntry>(MAX_CHOICES)

  return {
    offer: (input) => offerChoices({ entries, locale }, input),
    isCode: (text) => CHOICE_CODE_RE.test(text.trim()),
    lookup: (chatId, text) => lookupCode(entries, chatId, text),
  }
}

interface OfferContext {
  readonly entries: LruMap<string, ChoiceEntry>
  readonly locale: Locale
}

function offerChoices(ctx: OfferContext, input: ChoiceOffer): readonly string[] {
  const codes: string[] = []

  while (codes.length < input.buttons.length) {
    const code = drawCode(ctx.entries, input.chatId, codes)

    if (code === undefined) {
      return []
    }

    codes.push(code)
  }

  input.buttons.forEach((button, index) => {
    const code = codes[index]

    if (code !== undefined) {
      ctx.entries.set(keyOf(input.chatId, code), {
        callbackId: button.callbackId,
        expiresAt: input.expiresAt,
      })
    }
  })

  return [
    t(ctx.locale, 'channel.choiceIntro'),
    ...input.buttons.map((button, index) =>
      t(ctx.locale, 'channel.affordanceLine', {
        label: button.label,
        command: `${COMMAND_PREFIX}${codes[index] ?? ''}`,
      })
    ),
  ]
}

/** A zero-padded code this chat holds no entry for, or undefined after `CHOICE_DRAWS` tries: a code
 *  typed late for an old prompt must never answer a new one. */
function drawCode(
  entries: LruMap<string, ChoiceEntry>,
  chatId: string,
  taken: readonly string[]
): string | undefined {
  for (let draw = 0; draw < CHOICE_DRAWS; draw++) {
    const code = String(randomInt(CHOICE_CODE_SPACE)).padStart(CHOICE_CODE_DIGITS, '0')

    if (!taken.includes(code) && entries.get(keyOf(chatId, code)) === undefined) {
      return code
    }
  }

  return undefined
}

function lookupCode(
  entries: LruMap<string, ChoiceEntry>,
  chatId: string,
  text: string
): ChoiceLookup | undefined {
  const code = CHOICE_CODE_RE.exec(text.trim())?.[1]
  const entry = code === undefined ? undefined : entries.get(keyOf(chatId, code))

  if (entry === undefined) {
    return undefined
  }

  return entry.expiresAt <= Date.now()
    ? { kind: 'expired' }
    : { kind: 'live', callbackId: entry.callbackId }
}

function keyOf(chatId: string, code: string): string {
  return `${chatId}:${code}`
}
