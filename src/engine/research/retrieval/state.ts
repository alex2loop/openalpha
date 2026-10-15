import { scanOutput } from '@/core/security/sanitize'
import {
  extractQueryTerms,
  scoreParagraph,
  stripControls,
  stripMarkup,
  truncateUtf8HeadTail,
} from '@/core/utils/text'

import type { ResearchRetrievalAttempt, SourceId } from '../evidence/model'
import type { ResearchSearchResult } from './retrieval'
import type { GatherResult } from './types'
import { canonicalizeResearchUrl } from '../evidence/citations'
import { truncateAtSentenceBoundary } from '../evidence/normalize'
import { extractPublishedDay } from './page-dates'

const INLINE_WHITESPACE_RE = /[^\S\n]+/g
const NEWLINES_RE = /\n+/g
const NEWLINE_PADDING_RE = / *\n */g
const EXCESS_NEWLINES_RE = /\n{3,}/g
const SECURITY_NOTICE = 'Security notice: untrusted instructions were detected in this source.'
const PARAGRAPH_SPLIT_RE = /\n+/
const URL_RE = /https:\/\/[^\s<>"']+/i
const URL_TRAILING_PUNCTUATION = '.,;:)]}!?'

export interface ResearchRetrievalState {
  classifySubquery(query: string): 'available' | 'duplicate' | 'bound'
  rememberSubquery(query: string): 'new' | 'duplicate'
  getContent(url: string): string | undefined
  /** The page's own published day extracted from its markup at store time, when it had one. */
  getPublishedDay(url: string): string | undefined
  /** Stores per-source-bounded content; returns one status per input item. */
  storeContent(
    contents: readonly ResearchContentInput[]
  ): readonly ('stored' | 'duplicate' | 'skipped')[]
  dispose(): void
}

interface ResearchContentInput {
  readonly url: string
  readonly text: string
  /** Published day read from the page markup before it was converted to text. */
  readonly publishedDay?: string
}

interface ResearchRetrievalStateOptions {
  readonly maxSubqueries: number
  readonly maxContentBytesPerSource: number
}

export interface RetrievalCache {
  get(questionId: string): GatherResult | undefined
  put(questionId: string, gathered: GatherResult): void
  reserveOrder(): number
  complete(order: number, attempts: readonly ResearchRetrievalAttempt[]): void
  dispose(): void
}

export interface ResearchSourceBinding {
  readonly sourceId: SourceId
  readonly url: string
}

interface SubqueryRegistry {
  classify(query: string): 'available' | 'duplicate' | 'bound'
  remember(query: string): 'new' | 'duplicate'
  dispose(): void
}

interface ContentStore {
  get(url: string): string | undefined
  getPublishedDay(url: string): string | undefined
  store(contents: readonly ResearchContentInput[]): readonly ('stored' | 'duplicate' | 'skipped')[]
  dispose(): void
}

interface ContentState {
  readonly values: Map<string, string>
  readonly publishedDays: Map<string, string>
  disposed: boolean
}

export function createResearchRetrievalState(
  options: ResearchRetrievalStateOptions
): ResearchRetrievalState {
  const subqueries = createSubqueryRegistry(options.maxSubqueries)
  const content = createContentStore(options)

  return {
    classifySubquery: subqueries.classify,
    rememberSubquery: subqueries.remember,
    getContent: content.get,
    getPublishedDay: content.getPublishedDay,
    storeContent: content.store,
    dispose(): void {
      subqueries.dispose()
      content.dispose()
    },
  }
}

function createContentStore(
  options: Pick<ResearchRetrievalStateOptions, 'maxContentBytesPerSource'>
): ContentStore {
  const state: ContentState = {
    values: new Map(),
    publishedDays: new Map(),
    disposed: false,
  }

  return {
    get: (url) => (state.disposed ? undefined : state.values.get(normalizeUrl(url))),
    getPublishedDay: (url) =>
      state.disposed ? undefined : state.publishedDays.get(normalizeUrl(url)),
    store(contents): readonly ('stored' | 'duplicate' | 'skipped')[] {
      if (state.disposed) {
        return []
      }

      return contents.map((item) => {
        const key = normalizeUrl(item.url)
        if (key === '') {
          return 'skipped'
        }
        if (state.values.has(key)) {
          return 'duplicate'
        }

        const publishedDay = item.publishedDay ?? extractPublishedDay(item.text)
        const bounded = truncateUtf8HeadTail(
          sanitizeContent(item.text),
          options.maxContentBytesPerSource
        )
        if (bounded === '') {
          return 'skipped'
        }

        state.values.set(key, bounded)
        if (publishedDay !== undefined) {
          state.publishedDays.set(key, publishedDay)
        }
        return 'stored'
      })
    },
    dispose(): void {
      if (state.disposed) {
        return
      }

      state.disposed = true
      state.values.clear()
      state.publishedDays.clear()
    },
  }
}

function createSubqueryRegistry(maxSubqueries: number): SubqueryRegistry {
  const queries = new Set<string>()
  let disposed = false

  function classify(query: string): 'available' | 'duplicate' | 'bound' {
    const normalized = normalizeSubquery(query)

    if (disposed || normalized === '') {
      return 'bound'
    }
    if (queries.has(normalized)) {
      return 'duplicate'
    }
    return queries.size >= maxSubqueries ? 'bound' : 'available'
  }

  return {
    classify,
    remember(query): 'new' | 'duplicate' {
      if (classify(query) !== 'available') {
        return 'duplicate'
      }

      queries.add(normalizeSubquery(query))
      return 'new'
    },
    dispose(): void {
      disposed = true
      queries.clear()
    },
  }
}

export function createRetrievalCache(
  maxEntries: number,
  appendAttempts: (attempts: readonly ResearchRetrievalAttempt[]) => void
): RetrievalCache {
  const byQuestion = new Map<string, GatherResult>()
  const completed = new Map<number, readonly ResearchRetrievalAttempt[]>()
  let nextOrder = 0
  let flushOrder = 0

  return {
    get: (questionId) => byQuestion.get(questionId),
    put(questionId, gathered): void {
      // The cap bounds distinct questions, not rewrites: refusing an update to a key already held
      // would serve the stale gather on the next read.
      if (byQuestion.has(questionId) || byQuestion.size < maxEntries) {
        byQuestion.set(questionId, gathered)
      }
    },
    reserveOrder(): number {
      const order = nextOrder
      nextOrder += 1
      return order
    },
    complete(order, attempts): void {
      completed.set(order, attempts)
      while (completed.has(flushOrder)) {
        appendAttempts(completed.get(flushOrder) ?? [])
        completed.delete(flushOrder)
        flushOrder += 1
      }
    },
    dispose(): void {
      byQuestion.clear()
      completed.clear()
    },
  }
}

export function toBoundedQueryExcerpt(text: string, query: string, maxCharacters: number): string {
  const terms = extractQueryTerms(query)
  const selected = text
    .split(PARAGRAPH_SPLIT_RE)
    .filter((paragraph) => paragraph.trim() !== '')
    .map((paragraph, index) => ({ paragraph, index, score: scoreParagraph(paragraph, terms) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .filter((entry, index) => entry.score > 0 || index === 0)
    .map((entry) => entry.paragraph)
    .join('\n\n')

  return truncateAtSentenceBoundary(selected, maxCharacters)
}

export function explicitResearchUrl(query: string): string | undefined {
  const match = URL_RE.exec(query)?.[0]

  return match === undefined ? undefined : trimUrlPunctuation(match)
}

// A ')' stays when it closes a '(' inside the URL, as in a Wikipedia title.
function trimUrlPunctuation(url: string): string {
  let end = url.length

  while (end > 0 && URL_TRAILING_PUNCTUATION.includes(url.charAt(end - 1))) {
    const kept = url.slice(0, end)

    if (url.charAt(end - 1) === ')' && countChar(kept, '(') >= countChar(kept, ')')) {
      break
    }
    end -= 1
  }
  return url.slice(0, end)
}

function countChar(text: string, char: string): number {
  return text.split(char).length - 1
}

export function syntheticSearchResult(url: string): ResearchSearchResult {
  return { title: url, url, snippet: '', highlights: [], engines: [] }
}

export function selectSearchResultsBySourceId(
  results: readonly ResearchSearchResult[],
  sourceIds: readonly SourceId[],
  bindings: readonly ResearchSourceBinding[]
): readonly ResearchSearchResult[] {
  const selected = new Set(sourceIds)
  const urls = new Set(
    bindings
      .filter((binding) => selected.has(binding.sourceId))
      .map((binding) => normalizeUrl(binding.url))
  )

  return results.filter((result) => urls.has(normalizeUrl(result.url)))
}

function normalizeSubquery(query: string): string {
  return query.replace(INLINE_WHITESPACE_RE, ' ').replace(NEWLINES_RE, ' ').trim().toLowerCase()
}

// Shares the admission canonicalizer so a URL keyed here resolves to the same key downstream.
function normalizeUrl(value: string): string {
  return canonicalizeResearchUrl(value) ?? ''
}

function sanitizeContent(text: string): string {
  const plain = stripMarkup(stripControls(text))
    .replace(INLINE_WHITESPACE_RE, ' ')
    .replace(NEWLINE_PADDING_RE, '\n')
    .replace(EXCESS_NEWLINES_RE, '\n\n')
    .trim()

  return scanOutput(plain).length === 0 ? plain : `${SECURITY_NOTICE} ${plain}`
}
