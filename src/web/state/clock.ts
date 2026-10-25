import { type ReadonlySignal, type Signal, signal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

interface Ticker {
  readonly now: Signal<number>
  subscribers: number
  timer: ReturnType<typeof setInterval> | undefined
  visibility: AbortController | undefined
}

// One entry per distinct period, each a named constant, so the map stays a handful of entries. An
// entry is kept after its last subscriber leaves: a component rendered with its signal may subscribe
// in the same commit that another unsubscribes.
const tickers = new Map<number, Ticker>()

/** The current epoch ms, refreshed every `everyMs` by one interval shared by every caller of that
 *  period. A hidden tab clears it; on return it ticks once at once and re-arms. */
export function useNow(everyMs: number): ReadonlySignal<number> {
  const ticker = resolveTicker(everyMs)

  useEffect(() => subscribe(everyMs), [everyMs])

  return ticker.now
}

function resolveTicker(everyMs: number): Ticker {
  const held = tickers.get(everyMs)

  if (held !== undefined) {
    return held
  }

  const ticker: Ticker = {
    now: signal(Date.now()),
    subscribers: 0,
    timer: undefined,
    visibility: undefined,
  }

  tickers.set(everyMs, ticker)

  return ticker
}

function subscribe(everyMs: number): () => void {
  const ticker = resolveTicker(everyMs)

  ticker.subscribers++

  if (ticker.subscribers === 1) {
    const visibility = new AbortController()

    ticker.visibility = visibility
    document.addEventListener('visibilitychange', () => syncTimer(ticker, everyMs), {
      signal: visibility.signal,
    })
    syncTimer(ticker, everyMs)
  }

  return () => unsubscribe(ticker)
}

function unsubscribe(ticker: Ticker): void {
  ticker.subscribers--

  if (ticker.subscribers > 0) {
    return
  }

  ticker.visibility?.abort()
  clearInterval(ticker.timer)
  ticker.timer = undefined
}

function syncTimer(ticker: Ticker, everyMs: number): void {
  clearInterval(ticker.timer)
  ticker.timer = undefined

  if (document.hidden) {
    return
  }

  ticker.now.value = Date.now()
  ticker.timer = setInterval(() => {
    ticker.now.value = Date.now()
  }, everyMs)
}
