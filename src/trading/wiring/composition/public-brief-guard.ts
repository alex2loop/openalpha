import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type {
  PublicBriefRender,
  PublicBriefRow,
  PublicScreenText,
} from '@/trading/features/brief/public/types'
import type { BriefText } from '@/trading/features/brief/surface'
import type { TradingServices } from '@/trading/wiring/composition/service-aggregate'
import { formatErrForLog } from '@/core/security/credentials'
import { exemptTickers } from '@/trading/features/brief/public/scope'

const LOCALES: readonly Locale[] = ['en', 'vi']

type GuardVerdict =
  | { readonly kind: 'publish' }
  | { readonly kind: 'refuse'; readonly leaked: readonly string[] }

interface PublicBriefGuard {
  judge(row: PublicBriefRow, render: PublicBriefRender, signal: AbortSignal): Promise<GuardVerdict>
}

/** The last lock before a brief leaves the daemon, and the one public-brief file that reads the
 *  book. It refuses the day when a held or watched ticker stands in the text outside the rows of
 *  the brief's own market sections. A failed read of the book refuses too: the day is skipped,
 *  which is the safe direction. A name leaves only the owner's log, never the verdict's wording. */
export function createPublicBriefGuard(
  services: TradingServices,
  logger: Logger
): PublicBriefGuard {
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
        return { kind: 'refuse', leaked: [] }
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
  services: TradingServices,
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

/** The followed tickers that stand in the text as an uppercase whole word and are not exempt, in
 *  the order first seen. */
function leakedTickers(
  text: readonly string[],
  followed: ReadonlySet<string>,
  exempt: ReadonlySet<string>
): readonly string[] {
  const watched = [...followed].filter((ticker) => !exempt.has(ticker))

  if (watched.length === 0) {
    return []
  }

  // Longest first, so `BRK.B` is read whole before `BRK`.
  const alternatives = watched
    .toSorted((left, right) => right.length - left.length)
    .map(escapeRegExp)
  const word = new RegExp(`(?<![A-Za-z0-9])(?:${alternatives.join('|')})(?![A-Za-z0-9])`, 'g')

  return [...new Set(text.flatMap((line) => line.match(word) ?? []))]
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

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
