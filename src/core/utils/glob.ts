import { lruMap } from '@/core/utils/collections'

/** Longest glob a caller should accept from a model; matching is linear in it. */
export const GLOB_MAX_LENGTH = 512

const GLOB_CACHE_MAX = 256
const SEPARATOR = '/'
// A `**/` expands to three tokens: `dirs`, `globstar`, and the separator literal.
const DIRS_TOKEN_SPAN = 3

type GlobToken =
  | { readonly kind: 'literal'; readonly char: string }
  | { readonly kind: 'single' }
  | { readonly kind: 'star' }
  | { readonly kind: 'globstar' }
  | { readonly kind: 'dirs' }

const globCache = lruMap<string, readonly GlobToken[]>(GLOB_CACHE_MAX)

export function isGlobMatch(pattern: string, path: string): boolean {
  const cached = globCache.get(pattern)
  const tokens = cached ?? tokenizeGlob(pattern)

  if (cached === undefined) {
    globCache.set(pattern, tokens)
  }

  return matchTokens(tokens, path)
}

// `**/` is zero or more whole directories: a `dirs` marker that may jump over the `globstar` and
// separator literal following it. `**` is any run of characters, `*` any run inside one segment,
// `?` one non-separator character.
function tokenizeGlob(pattern: string): readonly GlobToken[] {
  const tokens: GlobToken[] = []
  let i = 0

  while (i < pattern.length) {
    if (pattern.startsWith('**/', i)) {
      tokens.push({ kind: 'dirs' }, { kind: 'globstar' }, { kind: 'literal', char: SEPARATOR })
      i += 3
    } else if (pattern.startsWith('**', i)) {
      tokens.push({ kind: 'globstar' })
      i += 2
    } else if (pattern[i] === '*') {
      tokens.push({ kind: 'star' })
      i += 1
    } else if (pattern[i] === '?') {
      tokens.push({ kind: 'single' })
      i += 1
    } else {
      tokens.push({ kind: 'literal', char: pattern.charAt(i) })
      i += 1
    }
  }

  return tokens
}

// Simulates the pattern as an automaton over the path, one character at a time, keeping the set of
// token positions still alive. Cost is tokens x path length however many wildcards the pattern has,
// where a backtracking regex goes exponential in them and cannot be interrupted once started.
function matchTokens(tokens: readonly GlobToken[], path: string): boolean {
  const accepting = tokens.length
  let active = new Uint8Array(accepting + 1)
  let next = new Uint8Array(accepting + 1)

  active[0] = 1
  skipOptional(tokens, active)

  for (let i = 0; i < path.length; i++) {
    const char = path.charAt(i)

    next.fill(0)

    for (let p = 0; p < accepting; p++) {
      const move = active[p] === 1 ? moveOf(tokens[p], char) : undefined

      if (move !== undefined) {
        next[p + move] = 1
      }
    }

    skipOptional(tokens, next)

    if (!next.includes(1)) {
      return false
    }

    ;[active, next] = [next, active]
  }

  return active[accepting] === 1
}

// Where consuming `char` at a token leads, as an offset from it: 0 stays (a wildcard absorbing
// another character), 1 moves on, undefined means the character does not fit.
function moveOf(token: GlobToken | undefined, char: string): number | undefined {
  switch (token?.kind) {
    case 'literal':
      return char === token.char ? 1 : undefined
    case 'single':
      return char === SEPARATOR ? undefined : 1
    case 'star':
      return char === SEPARATOR ? undefined : 0
    case 'globstar':
      return 0
    default:
      return undefined
  }
}

// Moves that consume nothing: a wildcard may match nothing, so reaching it also reaches the token
// after it, and a `dirs` marker is entered or jumped over whole. Ascending order carries the reach
// through a run of them.
function skipOptional(tokens: readonly GlobToken[], states: Uint8Array): void {
  for (let p = 0; p < tokens.length; p++) {
    const kind = tokens[p]?.kind

    if (states[p] !== 1) {
      continue
    }

    if (kind === 'star' || kind === 'globstar') {
      states[p + 1] = 1
    } else if (kind === 'dirs') {
      states[p + 1] = 1
      states[p + DIRS_TOKEN_SPAN] = 1
    }
  }
}
