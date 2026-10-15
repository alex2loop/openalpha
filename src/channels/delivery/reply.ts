import type { ChannelAdapter, OutboundButton, ReactionEmoji } from '@/channels/types'
import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import { assertNotAborted, ChannelError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { sleep } from '@/core/utils/time'
import { t } from '@/i18n'

// Telegram drops its typing indicator after ~5s, so the re-send is load-bearing, not decorative.
const TYPING_INTERVAL_MS = 4_000
// A server may ask us to back off for minutes; past this it is not worth holding the reply.
const MAX_RETRY_AFTER_MS = 30_000
const FINAL_WRITE: UpdateOptions = { retryOn429: true }

interface UpdateOptions {
  readonly useMarkup?: boolean
  /** Swallow a failed edit instead of logging it — used for throttled mid-stream writes. */
  readonly silent?: boolean
  /** Marks the final write: honour a 429 backoff hint and retry once, and let a failure reach the
   *  caller instead of logging it. */
  readonly retryOn429?: boolean
  /** Re-attach the cancel button. Live previews keep it; the final write drops it. */
  readonly keepCancel?: boolean
  readonly signal?: AbortSignal
}

export interface Reply {
  open(text: string, options?: { readonly cancelData?: string }): Promise<boolean>
  update(text: string, options?: UpdateOptions): Promise<void>
  overflow(
    text: string,
    options?: { readonly useMarkup?: boolean; readonly signal?: AbortSignal }
  ): Promise<void>
  react(emoji: ReactionEmoji | null): Promise<void>
  typing(on: boolean): void
  /** Takes the cancel button off a placeholder that will stay as it is, because the answer went
   *  below an approval prompt instead of into it. */
  disarm(): Promise<void>
  readonly placeholderId: string | null
}

interface ReplyDeps {
  readonly adapter: ChannelAdapter
  readonly logger: Logger
  readonly chatId: string
  readonly inboundMessageId: string
  readonly inboundReactionRef?: string
  readonly useReactions: boolean
  readonly typingEnabled: boolean
  readonly locale: Locale
}

interface EditTarget {
  readonly messageId: string
  readonly text: string
  readonly buttons?: readonly OutboundButton[]
}

export function createReply(deps: ReplyDeps): Reply {
  const { adapter } = deps
  const typing = createTypingIndicator(deps)
  const canEdit = adapter.capabilities.canEdit && adapter.edit !== undefined
  let placeholderId: string | null = null
  let cancelData: string | undefined
  let shown: { readonly text: string; readonly useMarkup?: boolean } | null = null

  return {
    get placeholderId(): string | null {
      return placeholderId
    },

    async open(text, options): Promise<boolean> {
      cancelData = options?.cancelData
      placeholderId = await openPlaceholder(deps, text, cancelData)
      shown = placeholderId === null ? null : { text }

      return placeholderId !== null
    },

    async update(text, options): Promise<void> {
      // A channel that cannot edit gets a fresh message instead; the placeholder stays as-is.
      if (!(canEdit && placeholderId)) {
        await sendFresh(deps, text, options)

        return
      }

      const buttons =
        options?.keepCancel === true
          ? buildCancelButtons({ adapter: deps.adapter, locale: deps.locale, cancelData })
          : undefined

      shown = {
        text,
        ...(options?.useMarkup === undefined ? {} : { useMarkup: options.useMarkup }),
      }

      await editOrResend(
        deps,
        { messageId: placeholderId, text, ...(buttons === undefined ? {} : { buttons }) },
        options ?? {}
      )
    },

    // Chunks past the first are new messages threaded under the placeholder. Each carries the final
    // write's guarantee: a lost chunk is a lost part of the answer, so its failure reaches the caller.
    async overflow(text, options): Promise<void> {
      await sendFinal(deps, {
        text,
        useMarkup: options?.useMarkup,
        under: placeholderId,
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      })
    },

    react: (emoji) => applyReaction(deps, emoji),

    typing: typing.set,

    async disarm(): Promise<void> {
      if (!(canEdit && placeholderId && shown && cancelData)) {
        return
      }

      await editWithRetry(deps, { messageId: placeholderId, text: shown.text }, shown)
    },
  }
}

// A channel that cannot edit gets a fresh message instead; the placeholder stays as-is.
async function sendFresh(
  deps: ReplyDeps,
  text: string,
  options: UpdateOptions | undefined
): Promise<void> {
  assertNotAborted(options?.signal)

  const send = {
    text,
    useMarkup: options?.useMarkup,
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
  }

  if (options?.retryOn429) {
    await sendFinal(deps, send)
  } else {
    await sendThreaded(deps, send)
  }
}

// Null means the channel would not even take the placeholder — the caller must give up rather than run a turn.
async function openPlaceholder(
  deps: ReplyDeps,
  text: string,
  cancelData: string | undefined
): Promise<string | null> {
  const { adapter } = deps
  const buttons = buildCancelButtons({ adapter: deps.adapter, locale: deps.locale, cancelData })

  try {
    const ref = await adapter.send({
      channel: adapter.id,
      chatId: deps.chatId,
      text,
      replyToMessageId: deps.inboundMessageId,
      ...(buttons ? { buttons } : {}),
    })

    return ref.messageId
  } catch (err: unknown) {
    deps.logger.warn('reply.open_failed', { channel: adapter.id, err: formatErrForLog(err) })

    return null
  }
}

interface CancelButtonsInput {
  readonly adapter: ChannelAdapter
  readonly locale: Locale
  readonly cancelData: string | undefined
}

/** The one cancel keyboard, or nothing on a channel without inline buttons. */
export function buildCancelButtons(
  input: CancelButtonsInput
): readonly OutboundButton[] | undefined {
  if (!(input.adapter.capabilities.inlineButtons && input.cancelData)) {
    return undefined
  }

  return [{ label: t(input.locale, 'ui.cancel'), callbackId: input.cancelData }]
}

interface ThreadedSend {
  readonly text: string
  readonly useMarkup?: boolean | undefined
  /** Thread under the placeholder when there is one, else under the user's own message. */
  readonly under?: string | null
  readonly signal?: AbortSignal
}

async function postThreaded(deps: ReplyDeps, send: ThreadedSend): Promise<void> {
  await deps.adapter.send(
    {
      channel: deps.adapter.id,
      chatId: deps.chatId,
      text: send.text,
      replyToMessageId: send.under ?? deps.inboundMessageId,
      ...(send.useMarkup === undefined ? {} : { useMarkup: send.useMarkup }),
    },
    send.signal === undefined ? undefined : { signal: send.signal }
  )
}

async function sendThreaded(deps: ReplyDeps, send: ThreadedSend): Promise<void> {
  try {
    await postThreaded(deps, send)
  } catch (err: unknown) {
    deps.logger.warn('reply.send_failed', {
      channel: deps.adapter.id,
      err: formatErrForLog(err),
    })
  }
}

// The final write has no other route to the operator, so its failure reaches the caller, after one
// wait for a rate-limit hint.
async function sendFinal(deps: ReplyDeps, send: ThreadedSend): Promise<void> {
  try {
    await postThreaded(deps, send)
  } catch (err: unknown) {
    const waitMs = retryDelayFor(err, FINAL_WRITE)

    if (waitMs === null) {
      throw err
    }

    await sleep(waitMs, send.signal)
    assertNotAborted(send.signal)
    await postThreaded(deps, send)
  }
}

// Reactions land on the user's message ('👀' seen, '✅' done) — never on our own reply.
async function applyReaction(deps: ReplyDeps, emoji: ReactionEmoji | null): Promise<void> {
  const { adapter } = deps

  if (!(deps.useReactions && adapter.capabilities.reactions && adapter.setReaction)) {
    return
  }

  try {
    await adapter.setReaction({
      chatId: deps.chatId,
      messageId: deps.inboundMessageId,
      ...(deps.inboundReactionRef !== undefined ? { reactionRef: deps.inboundReactionRef } : {}),
      emoji,
    })
  } catch (err: unknown) {
    // Cosmetic: a failed reaction must never affect the answer.
    deps.logger.debug('reply.react_failed', { channel: adapter.id, err: formatErrForLog(err) })
  }
}

/** The channel's "processing" signal, owned here so the agent exchange and a long-running slash
 *  command arm the same one. */
interface TypingDeps {
  readonly adapter: ChannelAdapter
  readonly logger: Logger
  readonly chatId: string
  readonly typingEnabled: boolean
}

interface TypingIndicator {
  set(on: boolean): void
}

export function createTypingIndicator(deps: TypingDeps): TypingIndicator {
  const { adapter } = deps
  const enabled =
    deps.typingEnabled && adapter.capabilities.typing && adapter.chatAction !== undefined
  let timer: ReturnType<typeof setInterval> | null = null

  const ping = (): void => {
    adapter.chatAction?.(deps.chatId, 'typing').catch((err: unknown) => {
      deps.logger.debug('reply.typing_failed', { channel: adapter.id, err: formatErrForLog(err) })
    })
  }

  return {
    set(on): void {
      if (!enabled) {
        return
      }

      if (!on) {
        if (timer) {
          clearInterval(timer)
          timer = null
        }

        return
      }

      if (timer) {
        return
      }

      ping()
      // A cosmetic ping is never the reason the process stays up; the orchestrator still stops it.
      timer = setInterval(ping, TYPING_INTERVAL_MS).unref()
    },
  }
}

async function editWithRetry(
  deps: ReplyDeps,
  target: EditTarget,
  options: UpdateOptions
): Promise<void> {
  assertNotAborted(options.signal)

  try {
    await runEdit(deps, target, options)

    return
  } catch (err: unknown) {
    const waitMs = retryDelayFor(err, options)

    if (waitMs === null) {
      settleFailedEdit(deps, err, options)

      return
    }

    await sleep(waitMs, options.signal)
  }

  assertNotAborted(options.signal)

  try {
    await runEdit(deps, target, options)
  } catch (retryErr: unknown) {
    settleFailedEdit(deps, retryErr, options)
  }
}

async function runEdit(deps: ReplyDeps, target: EditTarget, options: UpdateOptions): Promise<void> {
  await deps.adapter.edit?.({
    chatId: deps.chatId,
    messageId: target.messageId,
    text: target.text,
    ...(target.buttons === undefined ? {} : { buttons: target.buttons }),
    ...(options.useMarkup === undefined ? {} : { useMarkup: options.useMarkup }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
}

// Only the final write waits out a 429: a throttled mid-stream edit that had to sleep would be stale by the t.
function retryDelayFor(err: unknown, options: UpdateOptions): number | null {
  if (!(options.retryOn429 && err instanceof ChannelError) || err.retryAfterMs === undefined) {
    return null
  }

  return Math.min(err.retryAfterMs, MAX_RETRY_AFTER_MS)
}

// Only the final write falls back to a new message; a progress edit never throws past editWithRetry.
async function editOrResend(
  deps: ReplyDeps,
  target: EditTarget,
  options: UpdateOptions
): Promise<void> {
  try {
    await editWithRetry(deps, target, options)
  } catch (err: unknown) {
    if (!options.retryOn429 || options.signal?.aborted) {
      throw err
    }

    logFailedEdit(deps, err, options)
    await sendFinal(deps, {
      text: target.text,
      useMarkup: options.useMarkup,
      under: target.messageId,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  }
}

// The final write hands its failure to the caller, which owns the fallback; any other edit is
// cosmetic and is logged and dropped.
function settleFailedEdit(deps: ReplyDeps, err: unknown, options: UpdateOptions): void {
  if (options.retryOn429) {
    throw err
  }

  logFailedEdit(deps, err, options)
}

function logFailedEdit(deps: ReplyDeps, err: unknown, options: UpdateOptions): void {
  if (options.silent) {
    return
  }

  deps.logger.warn('reply.edit_failed', {
    channel: deps.adapter.id,
    err: formatErrForLog(err),
  })
}
