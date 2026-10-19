import { randomInt } from 'node:crypto'

import type { OutboundButton } from '@/channels/types'
import type { Locale } from '@/core/types/locale'
import { type LruMap, lruMap } from '@/core/utils/collections'
import { t } from '@/i18n'

const CHOICE_CODE_RE = /^\/(\d{4})$/
const CHOICE_CODE_SPACE = 10_000
const CHOICE_CODE_DIGITS = 4
const CHOICE_DRAWS = 10
const MAX_CHOICES = 1_024
const COMMAND_PREFIX = '/'

interface ChoiceEntry {
  readonly callbackId: string
  /** The keys of every code the same offer minted, this one included. */
  readonly siblings: readonly string[]
  readonly expiresAt: number
}

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
  /** The callback data a live code stands for, without consuming it. */
  peek(chatId: string, text: string): string | undefined
  /** Drops the code and every sibling from the same offer. */
  discard(chatId: string, text: string): void
}

/** One per channel pipeline, shared by approvals and plan reviews so two prompts open in one chat
 *  never mint the same code. A code lives as long as its own prompt; the LRU only bounds memory. */
export function createTextChoices(locale: Locale): TextChoices {
  const entries = lruMap<string, ChoiceEntry>(MAX_CHOICES)

  return {
    offer: (input) => offerChoices({ entries, locale }, input),
    isCode: (text) => CHOICE_CODE_RE.test(text.trim()),
    peek: (chatId, text) => liveEntry(entries, chatId, text)?.callbackId,
    discard: (chatId, text) => {
      const entry = entries.get(keyOf(chatId, text.trim().slice(COMMAND_PREFIX.length)))

      for (const key of entry?.siblings ?? []) {
        entries.delete(key)
      }
    },
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

  const siblings = codes.map((code) => keyOf(input.chatId, code))

  input.buttons.forEach((button, index) => {
    const key = siblings[index]

    if (key !== undefined) {
      ctx.entries.set(key, { callbackId: button.callbackId, siblings, expiresAt: input.expiresAt })
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

/** A zero-padded code no live prompt in this chat holds, or undefined after `CHOICE_DRAWS` tries. */
function drawCode(
  entries: LruMap<string, ChoiceEntry>,
  chatId: string,
  taken: readonly string[]
): string | undefined {
  for (let draw = 0; draw < CHOICE_DRAWS; draw++) {
    const code = String(randomInt(CHOICE_CODE_SPACE)).padStart(CHOICE_CODE_DIGITS, '0')

    if (
      !taken.includes(code) &&
      liveEntry(entries, chatId, `${COMMAND_PREFIX}${code}`) === undefined
    ) {
      return code
    }
  }

  return undefined
}

/** A lapsed entry reads as missing and is dropped on the way. */
function liveEntry(
  entries: LruMap<string, ChoiceEntry>,
  chatId: string,
  text: string
): ChoiceEntry | undefined {
  const code = CHOICE_CODE_RE.exec(text.trim())?.[1]

  if (code === undefined) {
    return undefined
  }

  const key = keyOf(chatId, code)
  const entry = entries.get(key)

  if (entry === undefined) {
    return undefined
  }

  if (entry.expiresAt <= Date.now()) {
    entries.delete(key)

    return undefined
  }

  return entry
}

function keyOf(chatId: string, code: string): string {
  return `${chatId}:${code}`
}
