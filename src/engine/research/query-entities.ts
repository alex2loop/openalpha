const MAX_QUERY_ENTITIES = 12
const MIN_QUOTED_PHRASE_CHARS = 2
const MAX_QUOTED_PHRASE_CHARS = 80

const QUOTED_PHRASE_RE = /"([^"]{2,80})"/g
// Splitting keeps '-' and '_' intact so a compound survives to reach COMPOUND_RE.
const TOKEN_SPLIT_RE = /[\s,;:.!?()[\]{}/\\|]+/
const WORD_SPLIT_RE = /[^\p{Alphabetic}\p{Number}]+/u
const TRIM_EDGES_RE = /^[^\p{Alphabetic}\p{Number}]+|[^\p{Alphabetic}\p{Number}]+$/gu
const COMPOUND_SEPARATOR_RE = /[-_]/

// Acronyms and tickers (VIC, CPI, VN30F2512), CamelCase names (VinFast), and compounds carrying a
// separator or a digit suffix (BTC-USD, fts5). Each shape is high-IDF: a page containing one
// verbatim is on-topic, a page containing none of them is filler.
const ACRONYM_RE = /^\p{Uppercase_Letter}[\p{Uppercase_Letter}\p{Number}]+$/u
const CAMEL_CASE_RE =
  /^\p{Uppercase_Letter}[\p{Lowercase_Letter}\p{Number}]+(?:\p{Uppercase_Letter}[\p{Lowercase_Letter}\p{Number}]+)+$/u
const COMPOUND_RE = /^[\p{Alphabetic}\p{Number}]+(?:[-_][\p{Alphabetic}\p{Number}]+)+$/u
const DIGIT_SUFFIX_RE = /^\p{Alphabetic}{2,}\p{Number}+$/u

// Question and sentence words that survive the shape tests when a question is typed in caps or a
// sentence starts with them, and name nothing.
const ENTITY_STOP_WORDS: ReadonlySet<string> = new Set([
  'what',
  'how',
  'why',
  'when',
  'where',
  'which',
  'who',
  'whose',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'in',
  'on',
  'of',
  'for',
  'to',
  'by',
  'as',
  'at',
  'from',
  'with',
  'about',
  'vs',
  'versus',
  'do',
  'does',
  'did',
  'can',
  'could',
  'should',
  'would',
  'will',
  'may',
  'might',
  'best',
  'top',
  'latest',
  'current',
  'recent',
  'compare',
  'comparison',
  'overview',
])

/**
 * The named entities a question is about, recognised by shape alone: quoted phrases, acronyms and
 * tickers, CamelCase names, and separator or digit-suffixed compounds. Nothing outside the text is
 * consulted, so a term is an entity because the operator wrote it, not because a registry lists it.
 */
export function extractQueryEntities(text: string): readonly string[] {
  const found = new Map<string, string>()

  for (const match of text.matchAll(QUOTED_PHRASE_RE)) {
    const phrase = match[1]?.trim() ?? ''
    if (phrase.length >= MIN_QUOTED_PHRASE_CHARS && phrase.length <= MAX_QUOTED_PHRASE_CHARS) {
      remember(found, phrase)
    }
  }

  for (const raw of text.split(TOKEN_SPLIT_RE)) {
    const token = raw.replace(TRIM_EDGES_RE, '')
    if (isEntityToken(token)) {
      remember(found, token)
    }
  }

  return [...found.values()].slice(0, MAX_QUERY_ENTITIES)
}

/** The query's entities that none of the coverage strings mentions. */
export function uncoveredQueryEntities(
  query: string,
  coverage: readonly string[]
): readonly string[] {
  const entities = extractQueryEntities(query)
  if (entities.length === 0) {
    return []
  }

  const haystack = coverage.join('\n')
  const words = wordSet(haystack)
  return entities.filter((entity) => !mentions(entity, haystack, words))
}

/** Fraction of the entities that `text` mentions; zero when the question named none. */
export function queryEntityOverlap(entities: readonly string[], text: string): number {
  if (entities.length === 0) {
    return 0
  }

  const words = wordSet(text)
  const present = entities.filter((entity) => mentions(entity, text, words)).length
  return present / entities.length
}

function remember(found: Map<string, string>, value: string): void {
  const key = value.toLowerCase()
  if (!found.has(key)) {
    found.set(key, value)
  }
}

function isEntityToken(token: string): boolean {
  if (token.length < 2 || ENTITY_STOP_WORDS.has(token.toLowerCase())) {
    return false
  }

  return (
    ACRONYM_RE.test(token) ||
    CAMEL_CASE_RE.test(token) ||
    COMPOUND_RE.test(token) ||
    DIGIT_SUFFIX_RE.test(token)
  )
}

function wordSet(text: string): ReadonlySet<string> {
  return new Set(text.toLowerCase().split(WORD_SPLIT_RE).filter(Boolean))
}

// Whole-word matching, never substring: 'vic' sits inside "service" and 'ssi' inside "session", so
// a substring test scores every page mentioning either as naming the ticker. A quoted phrase
// carries its own spaces and can only match as a substring; a compound is split the way the word
// set already split the text, and every part must be present.
function mentions(entity: string, text: string, words: ReadonlySet<string>): boolean {
  const lower = entity.toLowerCase()

  if (lower.includes(' ')) {
    return text.toLowerCase().includes(lower)
  }
  if (COMPOUND_SEPARATOR_RE.test(lower)) {
    return lower.split(COMPOUND_SEPARATOR_RE).every((part) => words.has(part))
  }

  return words.has(lower)
}
