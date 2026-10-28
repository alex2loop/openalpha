import { joinList, withoutLeadingIcon } from '@/web/text/glyphs'

const LABEL_END = ': '
// The daemon ends a caution with the command that acts on it.
const TRAILING_COMMAND = / · \/.*$/

interface Caution {
  readonly label: string | undefined
  readonly body: string
}

function parse(line: string): Caution {
  const text = withoutLeadingIcon(line)
  const at = text.indexOf(LABEL_END)

  return at < 0
    ? { label: undefined, body: text }
    : { label: text.slice(0, at), body: text.slice(at + LABEL_END.length) }
}

/** What a caution says, without its icon, its "Market:" label or its trailing command: the same
 *  sentence reads the same wherever the daemon repeats it. */
export function cautionSaying(line: string): string {
  return parse(line).body.replace(TRAILING_COMMAND, '')
}

/** The cautions with those saying the same thing as one, its labels joined: "A, B: ...". */
export function mergeCautions(lines: readonly string[]): readonly string[] {
  const merged = new Map<string, { labels: Set<string>; body: string }>()

  for (const line of lines) {
    const { label, body } = parse(line)
    const saying = cautionSaying(line)
    const entry = merged.get(saying) ?? { labels: new Set<string>(), body }

    if (label !== undefined) {
      entry.labels.add(label)
    }

    merged.set(saying, entry)
  }

  return [...merged.values()].map(({ labels, body }) =>
    labels.size === 0 ? body : `${joinList([...labels])}${LABEL_END}${body}`
  )
}
