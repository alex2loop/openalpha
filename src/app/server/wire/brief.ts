/** The brief as the CLI prints it, without its icons and indents. */
export interface BriefTextWire {
  readonly title: string
  /** The headline figures, one cell each, as the CLI prints them under the title. Absent from an
   *  older daemon. */
  readonly strip?: readonly string[]
  /** True when a section carries a call a model argued: the page opens with the AI label. A page
   *  labels unless this is false, so a daemon that predates the field is labelled too. */
  readonly aiGenerated: boolean
  /** The verdict block's heading, as the CLI prints it. Absent from an older daemon. */
  readonly verdictTitle?: string
  /** The answer: the session sentence and the figures it rests on. */
  readonly verdict: readonly string[]
  /** How many of the verdict's opening lines are the session sentence; the rest are figures. */
  readonly readingLines: number
  /** What to do first, right under the verdict with no heading, as the CLI prints it. Absent from an
   *  older daemon, which lists it as a section. */
  readonly nextActions?: readonly string[]
  /** The review of earlier stories and today's story, each line with its role; empty when the brief
   *  tells none. */
  readonly story: readonly {
    /** A block's title, the heading of a group under it, the sentence that opens a block, a figure
     *  or watch, the reading drawn from them, or where its numbers come from. */
    readonly role: 'title' | 'heading' | 'lead' | 'row' | 'note' | 'source'
    readonly text: string
  }[]
  /** Ready and unavailable sections, block by block in the CLI's order; one turned off by policy is
   *  not here, and neither is the cost, which the app's budget screen states. */
  readonly sections: readonly {
    /** Unique in the brief: a market's kind repeats once per market. */
    readonly id: string
    readonly kind: string
    /** The heading of the block the section sits in, as the CLI prints it. Absent from an older
     *  daemon. */
    readonly block?: string
    /** The market's name, on a section that belongs to one. */
    readonly market?: string
    readonly status: 'ready' | 'unavailable'
    /** Reference the CLI folds away; a page opens it on request. */
    readonly folded?: true
    readonly heading: string
    readonly lines: readonly string[]
    /** Each line's depth, level with `lines`: 0 for a row, 1 for the detail under it. Absent from an
     *  older daemon, where every line is a row. */
    readonly depths?: readonly number[]
  }[]
  /** Every caveat the brief carries, stated once, as the CLI words them. */
  readonly caveats: readonly string[]
}
