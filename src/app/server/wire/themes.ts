// /v1 themes contract: the operator's theme list and the moves on it, as `/themes` makes them.

/** One theme the operator has not closed: `proposed` waits for a decision, `active` and
 *  `weakening` are tracked, `invalidated` met a condition that ends it and waits to be retired. */
interface ThemeWire {
  readonly id: string
  /** In the language the run wrote it in. */
  readonly title: string
  readonly status: string
  /** `emerging`, `scaling` or `mature`. */
  readonly maturity: string
}

/** GET /v1/themes — the open themes and `/themes show`'s text for them, one entry per line, in the
 *  daemon's language. Reads the store; no model. */
export interface ThemesResponse {
  readonly themes: readonly ThemeWire[]
  readonly text: readonly string[]
}

/** `approve` and `reject` answer a proposed theme, `retire` a tracked or invalidated one. */
export type ThemeTransitionWire = 'approve' | 'reject' | 'retire'

/** POST /v1/themes/:id/:transition — `/themes`'s sentence for the move. A move the theme's status
 *  does not allow is 409 with the sentence; an unknown id 404. */
export interface ThemeTransitionResult {
  readonly text: string
}
