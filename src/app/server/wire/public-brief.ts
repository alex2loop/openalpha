import type { BriefTextWire } from './brief'

type PublicLocale = 'vi' | 'en'

/** The version of the posted document, held by the mapper, the Worker and the app. */
export const PUBLIC_BRIEF_WIRE_SCHEMA = 1

/** One market's screen board, ranked by score: a line per name, in the reader's language. */
export interface PublicScreenWire {
  readonly market: string
  readonly title: string
  readonly asOf: string
  readonly rows: readonly { readonly ticker: string; readonly line: string }[]
  readonly note: string
}

/** What the daemon posts once a day and the phone app reads: the market-only brief and its screens
 *  in both languages. A reader ignores a top-level key it does not know. */
export interface PublicBriefDocument {
  readonly schema: typeof PUBLIC_BRIEF_WIRE_SCHEMA
  /** The Vietnam trading day, `YYYY-MM-DD`. */
  readonly day: string
  readonly builtAt: number
  readonly briefs: Record<PublicLocale, BriefTextWire>
  readonly screens: Record<PublicLocale, readonly PublicScreenWire[]>
  readonly headline: Record<PublicLocale, string>
}

/** The Worker's answer to a publish. */
export interface PublishAnswer {
  /** False when the same brief was already held for the day. */
  readonly stored: boolean
}
