import type { Logger } from '@/core/logging/logger'
import type {
  PublicBriefRender,
  PublicBriefRow,
  PublicScreenText,
} from '@/trading/features/brief/public/types'
import type { BriefText } from '@/trading/features/brief/surface'
import type { TradingServices } from '@/trading/wiring/composition/service-aggregate'
import { formatErrForLog } from '@/core/security/credentials'
import { LOCALES } from '@/core/types/locale'
import { exemptTickers } from '@/trading/features/brief/public/scope'

/** A ticker this long or longer is read in any case: a short one (`T`, `VN`) is an ordinary word or
 *  letter pair in any other. */
const CASE_BLIND_MIN_LENGTH = 3
const SEPARATOR_RE = /[._-]/
const SEPARATOR_CLASS = '[._-]'
/** A glued word ends where its case turns: `HPGvà`, `fooHPG`. */
const WORD_START = '(?:(?<![A-Za-z0-9])|(?<=[a-z])(?=[A-Z]))'
const WORD_END = '(?:(?![A-Za-z0-9])|(?<=[A-Z])(?=[a-z])|(?<=[a-z])(?=[A-Z]))'
const STRICT_START = '(?<![A-Za-z0-9])'
const STRICT_END = '(?![A-Za-z0-9])'

type GuardServices = Pick<TradingServices, 'portfolio' | 'profiles'>

type GuardVerdict =
  | { readonly kind: 'publish' }
  | { readonly kind: 'refuse'; readonly leaked: readonly string[] }
  | { readonly kind: 'unread' }

interface PublicBriefGuard {
  judge(row: PublicBriefRow, render: PublicBriefRender, signal: AbortSignal): Promise<GuardVerdict>
}

/** The last lock before a brief leaves the daemon, and the one public-brief file that reads the
 *  book. It refuses the day when a held or watched ticker stands in the text outside the rows the
 *  brief prints for its own markets. A failed read of the book publishes nothing either, and says
 *  so apart from a refusal, because a later attempt may read it. A name leaves only the owner's log,
 *  never the verdict's wording. */
export function createPublicBriefGuard(services: GuardServices, logger: Logger): PublicBriefGuard {
  return {
    async judge(row, render, signal) {
      const followed = await readFollowed(services, signal).catch((err: unknown) => {
        logger.error('trading.public_brief_guard_unread', {
          day: row.day,
          err: formatErrForLog(err),
        })

        return undefined
      })

      if (followed === undefined) {
        return { kind: 'unread' }
      }

      const leaked = leakedTickers(textOf(render), followed, exemptTickers(row))

      if (leaked.length === 0) {
        return { kind: 'publish' }
      }

      logger.error('trading.public_brief_refused', { day: row.day, leaked })

      return { kind: 'refuse', leaked }
    },
  }
}

/** The held tickers with residue included, and the watchlist. */
async function readFollowed(
  services: GuardServices,
  signal: AbortSignal
): Promise<ReadonlySet<string>> {
  const now = Date.now()
  const [positions, profile] = await Promise.all([
    services.portfolio.positionsAt({ now, signal }),
    services.profiles.get({ signal }),
  ])

  return new Set(
    [...positions.map((position) => position.instrument), ...profile.watchlist].map(
      (instrument) => instrument.ticker
    )
  )
}

/** The followed tickers that stand in the text as a whole word and are not exempt, in the order
 *  followed. A ticker of three characters or more is read in any case, with `.`, `-` and `_` as one
 *  separator (`BRK.B` is `brk-b`); a shorter one only in capitals. */
function leakedTickers(
  text: readonly string[],
  followed: ReadonlySet<string>,
  exempt: ReadonlySet<string>
): readonly string[] {
  return [...followed]
    .filter((ticker) => !exempt.has(ticker))
    .filter((ticker) => {
      const word = toWordPattern(ticker)

      return text.some((line) => word.test(line))
    })
}

function toWordPattern(ticker: string): RegExp {
  const isCaseBlind = ticker.length >= CASE_BLIND_MIN_LENGTH
  const body = ticker
    .split(SEPARATOR_RE)
    .map((part) => [...part].map((char) => toCharPattern(char, isCaseBlind)).join(''))
    .join(SEPARATOR_CLASS)

  return isCaseBlind
    ? new RegExp(`${WORD_START}${body}${WORD_END}`)
    : new RegExp(`${STRICT_START}${body}${STRICT_END}`)
}

/** One character, in both cases when the ticker is read in any. Not the `i` flag: the word bounds
 *  tell upper from lower case. */
function toCharPattern(char: string, isCaseBlind: boolean): string {
  const lower = char.toLowerCase()
  const upper = char.toUpperCase()

  return isCaseBlind && lower !== upper ? `[${upper}${lower}]` : escapeRegExp(char)
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Every line a reader sees, in both languages: the brief, the headline, the screen lists and the
 *  closing line. */
function textOf(render: PublicBriefRender): readonly string[] {
  return LOCALES.flatMap((locale) => [
    ...briefLines(render.texts[locale]),
    render.headline[locale],
    render.disclaimer[locale],
    ...render.screens[locale].flatMap(screenLines),
  ])
}

function briefLines(text: BriefText): readonly string[] {
  return [
    text.title,
    text.verdictTitle,
    ...text.verdict,
    ...text.nextActions,
    ...text.story.map((line) => line.text),
    ...text.sections.flatMap((section) => [
      section.block,
      section.heading,
      ...(section.market === undefined ? [] : [section.market]),
      ...section.lines,
    ]),
    ...text.caveats,
  ]
}

function screenLines(screen: PublicScreenText): readonly string[] {
  return [screen.title, screen.note, ...screen.rows.flatMap((row) => [row.ticker, row.line])]
}
