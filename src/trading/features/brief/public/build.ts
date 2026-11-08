import type { Locale } from '@/core/types/locale'
import type {
  BuiltPublicBriefRow,
  PublicBriefDeps,
  PublicBriefInput,
} from '@/trading/features/brief/public/types'
import type { BriefSnapshot } from '@/trading/features/brief/types'
import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { MarketBriefRun } from '@/trading/markets/deps'
import { LOCAL_CHANNEL_ID } from '@/core/channels'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { createBudget } from '@/engine/api'
import { toPublicSnapshot } from '@/trading/features/brief/public/render'
import {
  carriedSections,
  PUBLIC_CORE_SECTIONS,
  PUBLIC_DROPPED_FIELDS,
  PUBLIC_SESSION_KIND,
  publicSectionKinds,
  publicStoryOmits,
} from '@/trading/features/brief/public/scope'
import { readPublicScreens } from '@/trading/features/brief/public/screen'
import { runMarketBrief } from '@/trading/features/brief/run'
import { isDeliverable } from '@/trading/markets/brief-deliverability'
import { resolveSettledDay } from '@/trading/markets/calendar'

/** Sections carry no wording; the language only names what a suggestion run would be written in,
 *  and this build runs none. */
const BUILD_LOCALE: Locale = 'en'

/** The day's public brief, saved: the market sections the toggles allow, read from an empty book.
 *  Null when what the build found is not worth publishing: no core section, or a tape that is not
 *  the last settled session's. */
export async function buildPublicBrief(
  deps: PublicBriefDeps,
  input: PublicBriefInput
): Promise<BuiltPublicBriefRow | null> {
  const { signal } = input

  await deps.refresh({ markets: deps.markets, withoutFollowed: true, signal })

  const built = await runMarketBrief(
    { logger: deps.logger, limit: deps.limit, omitStories: publicStoryOmits(deps.toggles) },
    {
      market: deps.market,
      request: buildRequest(deps, input),
      previous: await readPrevious(deps, input),
      asOf: input.day,
    }
  )
  const kept = keptSections(deps, built)

  if (!(isDeliverable(kept, PUBLIC_CORE_SECTIONS) && isSettledSession(deps, kept, input.now))) {
    return null
  }

  const screens = await readPublicScreens(deps, input)

  return deps.store.saveBuilt(
    { day: input.day, sections: kept, screens, builtAt: input.now },
    signal
  )
}

function buildRequest(deps: PublicBriefDeps, input: PublicBriefInput): MarketBriefRun {
  return {
    region: deps.market.manifest.region,
    locale: BUILD_LOCALE,
    asOf: input.day,
    now: input.now,
    signal: input.signal,
    watchlist: [],
    followedBlind: true,
    limit: deps.limit,
    // No book activity to report, and no scorecard to show.
    activitySince: input.now,
    scorecardShownThisMonth: true,
    channel: LOCAL_CHANNEL_ID,
    billingSessionId: null,
    budget: createBudget(0),
    reads: deps.reads,
  }
}

/** The previous brief is garnish: one that cannot be read is no previous, as for the owner's
 *  brief. */
async function readPrevious(
  deps: PublicBriefDeps,
  input: PublicBriefInput
): Promise<BriefSnapshot | null> {
  try {
    const row = await deps.store.findPrevious(input.day, input.signal)

    return row === null
      ? null
      : toPublicSnapshot(
          { ...row, sections: carriedSections(row.sections, deps.toggles) },
          BUILD_LOCALE
        )
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    deps.logger.warn('trading.public_brief_previous_unreadable', { err: formatErrForLog(err) })

    return null
  }
}

function keptSections(
  deps: PublicBriefDeps,
  sections: readonly BriefSectionResult[]
): readonly BriefSectionResult[] {
  const kinds = publicSectionKinds(deps.toggles)

  return sections.filter((section) => kinds.has(section.kind)).map(withoutDroppedFields)
}

function withoutDroppedFields(section: BriefSectionResult): BriefSectionResult {
  const dropped = PUBLIC_DROPPED_FIELDS[section.kind]

  if (section.status !== 'ready' || dropped === undefined) {
    return section
  }

  const rows = section.rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).filter(([field]) => !dropped.some((name) => name === field))
    )
  )

  return { ...section, rows }
}

/** The tape has no date of its own; the section that states the session its market's roll-ups were
 *  measured at must name the last settled one, or the day's numbers are an older session's. */
function isSettledSession(
  deps: PublicBriefDeps,
  sections: readonly BriefSectionResult[],
  now: number
): boolean {
  const { id, calendar } = deps.market.manifest
  const settled = resolveSettledDay(calendar, now)

  return sections.some(
    (section) =>
      section.kind === PUBLIC_SESSION_KIND &&
      section.market === id &&
      section.status === 'ready' &&
      section.asOf === settled
  )
}
