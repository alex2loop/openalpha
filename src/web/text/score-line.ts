import { joinInline, splitInline } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'

/** A line of the daemon's, one segment of it the composite, without that segment: the score is the
 *  advanced view's, and every other segment reads as the daemon wrote it. */
export function withoutScore(line: string): string {
  const scoreLead = tr('trading.render.screen.score', { score: '' }).trim()

  return joinInline(splitInline(line).filter((segment) => !segment.startsWith(scoreLead)))
}
