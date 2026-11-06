import type { BriefTextWire } from './brief'

type PublicLocale = 'vi' | 'en'

/** One market's screen board, ranked by score: a line per name, in the reader's language. */
interface PublicScreenWire {
  readonly market: string
  readonly title: string
  readonly asOf: string
  readonly rows: readonly { readonly ticker: string; readonly line: string }[]
  readonly note: string
}

/** What the daemon posts once a day and the phone app reads: the market-only brief and its screens
 *  in both languages. A reader ignores a top-level key it does not know. */
export interface PublicBriefDocument {
  readonly schema: 1
  /** The Vietnam trading day, `YYYY-MM-DD`. */
  readonly day: string
  readonly builtAt: number
  readonly briefs: Record<PublicLocale, BriefTextWire>
  readonly screens: Record<PublicLocale, readonly PublicScreenWire[]>
  readonly headline: Record<PublicLocale, string>
  readonly disclaimer: Record<PublicLocale, string>
}

/** The Worker's answer to a publish. */
export interface PublishAnswer {
  /** False when the same brief was already held for the day. */
  readonly stored: boolean
  readonly subscribers: number
  readonly rejected: number
}
