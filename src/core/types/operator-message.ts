/** What a surface may show an operator in their own language. Absent means the message is a
 *  diagnostic for the log, and the surface falls back to a generic line rather than printing
 *  English at someone who did not ask for it. `key` is a bare string because `core` cannot import
 *  `i18n`; the channel resolves it through `bindLocale`, which is where that widening lives. */
export interface OperatorMessage {
  readonly key: string
  readonly params?: Readonly<Record<string, OperatorParam>>
}

/** Mirrors i18n's `DisplayParam`, which `core` cannot import: a keyed phrase with the raw text to
 *  print where the catalog has none, or a `YYYY-MM-DD` day for the reader's date order. */
type OperatorParam =
  | string
  | number
  | { readonly day: string }
  | {
      readonly key: string
      readonly params?: Readonly<Record<string, string | number>>
      readonly fallback?: string
    }
