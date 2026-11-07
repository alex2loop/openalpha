import type { Locale } from '@/core/types/locale'
import type {
  BuiltPublicBriefRow,
  PublicBriefRender,
  PublicScreen,
  PublicScreenText,
} from '@/trading/features/brief/public/types'
import type { BriefText } from '@/trading/features/brief/surface'
import type { BriefSnapshot } from '@/trading/features/brief/types'
import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { RenderContext } from '@/trading/render/format'
import { truncate } from '@/core/utils/text'
import { t } from '@/i18n'
import { PUBLIC_CORE_SECTIONS } from '@/trading/features/brief/public/scope'
import { renderBriefForSurface } from '@/trading/features/brief/surface'
import { buildBriefSnapshotId } from '@/trading/features/brief/types'
import { toPlainText } from '@/trading/render/fold'
import {
  formatCount,
  NOTICE_SURFACE,
  renderDeclaredValue,
  resolveRenderContext,
} from '@/trading/render/format'
import { toBriefSectionText } from '@/trading/render/section'

const PUBLIC_HEADLINE_MAX_CHARS = 120
/** The profile revision a snapshot carries: the public brief is built against no profile. */
const PUBLIC_PROFILE_REVISION = 'public'

/** Both languages of one build, drawn by the renderer the owner's brief uses, in the daemon's own
 *  wording. The snapshot carries no brief-level caveats: those describe the owner's refresh and
 *  profile, and a section's own caveats travel with the section. */
export function renderPublicBrief(
  row: BuiltPublicBriefRow,
  options: { readonly timezone: string }
): PublicBriefRender {
  const texts = perLocale((locale) =>
    renderBriefForSurface(locale, toPublicSnapshot(row, locale), options)
  )
  const context = resolveRenderContext(options.timezone, NOTICE_SURFACE)

  return {
    day: row.day,
    builtAt: row.builtAt,
    texts,
    screens: perLocale((locale) =>
      (row.screens ?? []).map((screen) => toScreenText(locale, screen))
    ),
    headline: perLocale((locale) => headlineOf(texts[locale], coreLineOf(locale, row, context))),
  }
}

/** The row as the story step and the renderer read a snapshot. */
export function toPublicSnapshot(row: BuiltPublicBriefRow, locale: Locale): BriefSnapshot {
  return {
    id: buildBriefSnapshotId(row.builtAt),
    asOf: row.day,
    authoredLocale: locale,
    profileRevision: PUBLIC_PROFILE_REVISION,
    sections: row.sections,
    caveats: [],
    createdAt: row.builtAt,
  }
}

function toScreenText(locale: Locale, screen: PublicScreen): PublicScreenText {
  const rows = screen.rows[locale]

  return {
    market: screen.market,
    title: t(locale, 'trading.publicBrief.screenTitle', {
      market: renderDeclaredValue(locale, `trading.market.${screen.market}`),
      count: formatCount(locale, rows.length),
    }),
    asOf: screen.asOf,
    rows,
    note: t(locale, 'trading.publicBrief.screenNote'),
  }
}

function perLocale<T>(make: (locale: Locale) => T): Record<Locale, T> {
  return { en: make('en'), vi: make('vi') }
}

/** Today's story lead, which follows the reviews of earlier stories, else the core section's first
 *  line. The core section is not printed as a section of its own: the verdict block quotes it. */
function headlineOf(text: BriefText, coreLine: string | undefined): string {
  const storyStart = text.story.findLastIndex((line) => line.role === 'title') + 1
  const lead = text.story.slice(storyStart).find((line) => line.role === 'lead')?.text

  return truncate(toPlainText(lead ?? coreLine ?? text.title), PUBLIC_HEADLINE_MAX_CHARS)
}

function coreLineOf(
  locale: Locale,
  row: BuiltPublicBriefRow,
  context: RenderContext
): string | undefined {
  const core = row.sections.find(isCore)

  return core === undefined
    ? undefined
    : toBriefSectionText(locale, core, context).lines[0]?.trimStart()
}

function isCore(section: BriefSectionResult): boolean {
  return PUBLIC_CORE_SECTIONS.some((kind) => kind === section.kind)
}
