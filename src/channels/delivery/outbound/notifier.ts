import type { ChannelOutbound, OutboundTarget, SentRef } from '@/channels/types'
import type { Logger } from '@/core/logging/logger'
import { ChannelError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { settleWithin } from '@/core/utils/concurrency'

const WINDOW_MS = 60_000
// A transport that just refused a send is the last thing to hammer; the retry waits out the blip.
const RETRY_BACKOFF_BASE_MS = 1_000
// A provider's Retry-After is honoured whole, so a flood-control window is not retried inside; the
// bound only stops an absurd value from parking the queue for hours.
const MAX_RETRY_AFTER_MS = 600_000

type SenderFn = (
  out: ChannelOutbound,
  options?: { readonly signal?: AbortSignal }
) => Promise<SentRef>

export type NotifyOutcome = 'delivered' | 'dropped' | 'aborted'

interface NotifyResult {
  readonly outcome: NotifyOutcome
  /** The message the transport made; present only when the outcome is `delivered`. */
  readonly ref?: SentRef
}

interface NotifyOptions {
  readonly signal?: AbortSignal
  readonly useMarkup?: boolean
}

interface NotifierDeps {
  readonly logger: Logger
  readonly sender: SenderFn
  readonly maxPerMinute: number
  readonly queueMax: number
  readonly maxAttempts: number
  readonly drainTimeoutMs: number
  readonly signal: AbortSignal
}

interface Note {
  readonly out: ChannelOutbound
  /** What the transport sees: the channel-lifetime signal composed with the caller's, so a
   *  cancelled caller stops an in-flight send instead of only abandoning its promise. */
  readonly sendSignal: AbortSignal
  readonly callerSignal?: AbortSignal
  attempts: number
  /** Set by the send that delivered it. */
  ref?: SentRef
  /** Epoch-ms the note is next due, set by the failure that queued it again. */
  noRetryBefore?: number
  settle: (outcome: NotifyOutcome) => void
}

export class Notifier {
  private readonly sentAt: number[] = []
  private readonly queue: Note[] = []
  private inFlight: Note | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private flushing: Promise<void> | null = null
  private dropWarned = false
  private disposed = false

  constructor(private readonly deps: NotifierDeps) {}

  // Resolves with the note's final disposition — sent, terminally dropped (retries exhausted,
  // evicted from a full queue, or shutdown), or aborted by the caller's own signal. It never
  // rejects: callers that must record a failed delivery branch on the outcome. Every send goes
  // through the queue and the single-flight flush: a direct dispatch would let two in-flight
  // transports race and deliver out of order.
  notify(target: OutboundTarget, text: string, options?: NotifyOptions): Promise<NotifyResult> {
    const signal = options?.signal
    const useMarkup = options?.useMarkup
    // Guarded before any enqueue or listener: arming and immediately tearing down would leave a
    // note in the queue for a caller that already gave up on it.
    if (signal?.aborted === true) {
      return Promise.resolve({ outcome: 'aborted' })
    }
    if (this.disposed || this.deps.signal.aborted) {
      return Promise.resolve({ outcome: 'dropped' })
    }

    const note: Note = {
      out: {
        channel: target.channel,
        chatId: target.chatId,
        text,
        ...(useMarkup === undefined ? {} : { useMarkup }),
      },
      sendSignal:
        signal === undefined ? this.deps.signal : AbortSignal.any([this.deps.signal, signal]),
      ...(signal === undefined ? {} : { callerSignal: signal }),
      attempts: 0,
      settle: () => undefined,
    }
    const done = new Promise<NotifyOutcome>((settle) => {
      note.settle = settle
      this.enqueue(note)
    })

    this.armAbort(note, signal)
    this.kick()

    return done.then((outcome) =>
      note.ref === undefined ? { outcome } : { outcome, ref: note.ref }
    )
  }

  /** A caller that gives up releases its note rather than holding a slot until the queue evicts it.
   *  The listener is dropped on every settle path, including the ordinary delivered one, so an
   *  aborted long-lived signal cannot accumulate handlers for notices already sent. */
  private armAbort(note: Note, signal: AbortSignal | undefined): void {
    if (signal === undefined) {
      return
    }

    const settle = note.settle
    const onAbort = (): void => {
      this.remove(note)
      settle('aborted')
    }

    note.settle = (outcome) => {
      signal.removeEventListener('abort', onAbort)
      settle(outcome)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  }

  private callerAborted(note: Note): boolean {
    return note.callerSignal?.aborted === true
  }

  private remove(note: Note): void {
    const index = this.queue.indexOf(note)

    if (index >= 0) {
      this.queue.splice(index, 1)
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return
    }
    this.disposed = true

    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    // Best-effort: on shutdown the remaining notices get one bounded attempt, rate limit ignored.
    // The in-flight flush is awaited alongside them so a send already out of the queue still gets to
    // report its real outcome before the deadline.
    const notes = this.queue.splice(0)
    const controller = new AbortController()
    let dropped = notes.length
    const drain = Promise.all([
      this.flushing?.catch(() => undefined),
      this.drainRemaining(notes, controller.signal, () => {
        dropped -= 1
      }),
    ])
    const completed = await settleWithin(drain, this.deps.drainTimeoutMs)

    if (completed) {
      return
    }

    const stranded = this.inFlight

    controller.abort()
    this.deps.logger.warn('notifier.drain_timeout', {
      dropped: dropped + (stranded === null ? 0 : 1),
    })

    // Resolve is idempotent, so settling everything here cannot clobber a delivery the timed-out
    // drain already reported — it only frees callers still awaiting a note it never reached.
    for (const note of notes) {
      note.settle('dropped')
    }

    stranded?.settle('dropped')
  }

  private hasHeadroom(now: number): boolean {
    while (this.sentAt.length > 0 && now - (this.sentAt[0] ?? now) >= WINDOW_MS) {
      this.sentAt.shift()
    }

    return this.sentAt.length < this.deps.maxPerMinute
  }

  private enqueue(note: Note): void {
    // Full queue drops the OLDEST: a stale notice is worth less than the one just produced.
    if (this.queue.length >= this.deps.queueMax) {
      this.queue.shift()?.settle('dropped')

      if (!this.dropWarned) {
        this.deps.logger.warn('notifier.queue_full', { queueMax: this.deps.queueMax })
        this.dropWarned = true
      }
    }

    this.queue.push(note)
  }

  private async deliver(note: Note): Promise<boolean> {
    const sentAt = Date.now()
    this.sentAt.push(sentAt)

    try {
      note.ref = await this.deps.sender(note.out, { signal: note.sendSignal })
      // One success means the backlog is moving again, so the next drop is worth warning about.
      this.dropWarned = false
      note.settle('delivered')

      return true
    } catch (err: unknown) {
      const index = this.sentAt.indexOf(sentAt)

      if (index >= 0) {
        this.sentAt.splice(index, 1)
      }

      // The caller's abort settled this note already; re-queueing would send a cancelled notice.
      if (this.callerAborted(note)) {
        note.settle('aborted')

        return false
      }

      note.attempts += 1

      note.noRetryBefore = Date.now() + retryDelayMs(note.attempts, err)

      if (note.attempts >= this.deps.maxAttempts) {
        this.deps.logger.warn('notifier.dropped', {
          channel: note.out.channel,
          attempts: note.attempts,
          err: formatErrForLog(err),
        })
        note.settle('dropped')

        return false
      }

      // A dispose that ran mid-send has already drained the queue: re-queueing now would strand
      // the note (and its awaiting caller) forever.
      if (this.disposed) {
        note.settle('dropped')

        return false
      }

      // Retried at the front so ordering survives a transient failure.
      this.queue.unshift(note)

      return false
    }
  }

  private kick(): void {
    this.flush().catch((err: unknown) => {
      this.deps.logger.warn('notifier.flush_failed', { err: formatErrForLog(err) })
    })
  }

  private schedule(): void {
    if (this.timer || this.queue.length === 0 || this.disposed) {
      return
    }

    this.timer = setTimeout(() => {
      this.timer = null
      this.kick()
    }, this.waitMs(Date.now()))
  }

  /** One clock read decides the whole wait: the window's remaining life and a provider's retry
   *  floor are two answers about the same instant, and reading twice lets them disagree. */
  private waitMs(now: number): number {
    const backoffMs = this.retryBackoffMs(now)

    if (this.hasHeadroom(now)) {
      return backoffMs
    }

    const oldest = this.sentAt[0]

    // The window frees up exactly when its oldest send ages out.
    const windowMs = oldest === undefined ? 0 : Math.max(0, oldest + WINDOW_MS - now)

    return Math.max(windowMs, backoffMs)
  }

  // The head of the queue is the note a failed delivery pushed back; it waits until the time that
  // failure set, or the retries burn inside a window the provider already refused.
  private retryBackoffMs(now: number): number {
    const head = this.queue[0]

    return head?.noRetryBefore === undefined ? 0 : Math.max(0, head.noRetryBefore - now)
  }

  private flush(): Promise<void> {
    this.flushing ??= this.drainQueue().finally(() => {
      this.flushing = null
      this.schedule()
    })

    return this.flushing
  }

  private async drainQueue(): Promise<void> {
    // Read per iteration, not per drain: a send takes real time, so the window ages between notes.
    while (!this.disposed && this.queue.length > 0 && this.isHeadReady(Date.now())) {
      const note = this.queue.shift()

      if (note === undefined) {
        break
      }

      // Held while the note is out of the queue: dispose can only settle a send that never returns
      // if it can still see the note.
      this.inFlight = note
      const delivered = await this.deliver(note)
      this.inFlight = null

      // A failure has already re-queued (or dropped) the note; stop and let the timer retry rather than hot-looping.
      if (!delivered) {
        break
      }
    }
  }

  // The window has room and the head note's own retry wait has passed.
  private isHeadReady(now: number): boolean {
    return this.hasHeadroom(now) && this.retryBackoffMs(now) === 0
  }

  // Settles every note: an awaiting notify() caller must never be left pending after shutdown.
  private async drainRemaining(
    notes: readonly Note[],
    signal: AbortSignal,
    onSettled: () => void
  ): Promise<void> {
    for (const note of notes) {
      // Settled by armAbort already; the drain must not give a cancelled notice its one attempt.
      if (this.callerAborted(note)) {
        note.settle('aborted')
        onSettled()
        continue
      }

      if (signal.aborted) {
        note.settle('dropped')
        continue
      }

      try {
        note.ref = await this.deps.sender(note.out, {
          signal: AbortSignal.any([signal, note.sendSignal]),
        })
        note.settle('delivered')
      } catch (err: unknown) {
        if (this.callerAborted(note)) {
          note.settle('aborted')
        } else {
          note.settle('dropped')
          this.deps.logger.warn('notifier.drain_failed', {
            channel: note.out.channel,
            err: formatErrForLog(err),
          })
        }
      } finally {
        onSettled()
      }
    }
  }
}

// Backoff by attempt count, floored by a provider's `Retry-After` (bounded, never shortened).
function retryDelayMs(attempts: number, err: unknown): number {
  const backoffMs = RETRY_BACKOFF_BASE_MS * 2 ** (attempts - 1)

  if (!(err instanceof ChannelError) || err.retryAfterMs === undefined) {
    return backoffMs
  }

  return Math.max(backoffMs, Math.min(err.retryAfterMs, MAX_RETRY_AFTER_MS))
}
