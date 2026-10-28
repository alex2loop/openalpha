/** The brief as the CLI prints it, without its icons and indents. */
export interface BriefTextWire {
  readonly title: string
  /** The answer: the session sentence and the figures it rests on. */
  readonly verdict: readonly string[]
  /** How many of the verdict's opening lines are the session sentence; the rest are figures. */
  readonly readingLines: number
  /** The review of earlier stories and today's story, each line with its role; empty when the brief
   *  tells none. */
  readonly story: readonly {
    /** A block's title, the heading of a group under it, the sentence that opens a block, a figure
     *  or watch, the reading drawn from them, or where its numbers come from. */
    readonly role: 'title' | 'heading' | 'lead' | 'row' | 'note' | 'source'
    readonly text: string
  }[]
  /** Ready and unavailable sections in the brief's order; one turned off by policy is not here, and
   *  neither is the cost or the macro reference the verdict already states. */
  readonly sections: readonly {
    /** Unique in the brief: a market's kind repeats once per market. */
    readonly id: string
    readonly kind: string
    /** The market's name, on a section that belongs to one. */
    readonly market?: string
    readonly status: 'ready' | 'unavailable'
    readonly heading: string
    readonly lines: readonly string[]
    /** Each line's depth, level with `lines`: 0 for a row, 1 for the detail under it. Absent from an
     *  older daemon, where every line is a row. */
    readonly depths?: readonly number[]
  }[]
  /** Every caveat the brief carries, stated once, as the CLI words them. */
  readonly caveats: readonly string[]
}
