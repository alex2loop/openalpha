/** A source a debate role cited and the suggestion carries. Neither module owns it: the roles
 *  produce citations, the stored suggestion keeps them, and the renderer prints them. */
export interface SuggestionCitation {
  readonly url: string
  readonly title?: string
  readonly publishedAt?: number
}

/** How many headlines the debate was handed, split the way the prompt splits them: the name's
 *  own coverage and the market's background. Carried for the same reason a citation is - a
 *  suggestion built on background alone must not read like one built on filings. */
export interface HeadlinesRead {
  readonly own: number
  readonly market: number
  /** What the decision provider billed to read them; zero when none was asked. */
  readonly costUsd: number
}
