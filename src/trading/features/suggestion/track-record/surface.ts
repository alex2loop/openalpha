import type { Locale } from '@/core/types/locale'
import type { TrackRecordReflection } from '@/trading/features/suggestion/suggestion'
import {
  reflectHeader,
  renderCalibrationLines,
  renderOutcomeLine,
  renderOverallLines,
} from '@/trading/features/suggestion/track-record/render'
import { renderActedLines } from '@/trading/features/suggestion/track-record/render-acted'
import { renderCoverageLine } from '@/trading/features/suggestion/track-record/render-coverage'
import { renderCaveatLines } from '@/trading/render/caveat'

export interface ReflectText {
  /** The header, the coverage, the overall figures and the CLI's small-sample warning. */
  readonly summary: readonly string[]
  readonly byConviction: readonly string[]
  readonly acted: readonly string[]
  readonly closed: readonly { readonly suggestionId: string; readonly line: string }[]
}

/** `/reflect`'s own lines for an app to lay out: the same functions, with every indent and section
 *  title trimmed (the app names its own sections). */
export function renderReflectForSurface(
  locale: Locale,
  reflection: TrackRecordReflection
): ReflectText {
  const { summary, recent } = reflection.report

  return {
    summary: trimmed([
      reflectHeader(locale, summary),
      ...renderCoverageLine(locale, summary.coverage),
      ...renderOverallLines(locale, summary),
      ...renderCaveatLines(locale, summary.caveats),
    ]),
    byConviction: trimmed(renderCalibrationLines(locale, summary.calibration).slice(1)),
    acted: trimmed(renderActedLines(locale, reflection.acted).slice(1)),
    closed: recent.map((row) => ({
      suggestionId: row.id,
      line: renderOutcomeLine(locale, row).trimStart(),
    })),
  }
}

function trimmed(lines: readonly string[]): readonly string[] {
  return lines.map((line) => line.trimStart())
}
