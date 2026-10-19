import type { ChannelSettings } from '@/channels/schema'
import type { ChannelAdapter, OutboundButton } from '@/channels/types'
import type { Logger } from '@/core/logging/logger'
import type { ProgressReporter } from '@/core/types/command'
import type { Locale } from '@/core/types/locale'
import { buildCancelButtons, createTypingIndicator } from '@/channels/delivery/reply'
import { formatErrForLog } from '@/core/security/credentials'
import { bindLocale } from '@/i18n'

// A command that answers faster than this never writes a notice, so an instant reply — a usage
// line, a rejected argument, a subscription toggle — is not preceded by a step that already
// finished. The chat keeps whatever is written, so an unearned notice outlives the answer it
// introduced.
const REVEAL_DELAY_MS = 1_500

interface SlashNoticeDeps {
  readonly adapter: ChannelAdapter
  readonly settings: ChannelSettings
  readonly logger: Logger
  readonly locale: Locale
  readonly chatId: string
  readonly replyToMessageId: string
  /** The command's own abort signal: once it fires, the notice ends as cancelled. */
  readonly signal: AbortSignal
  /** What the cancel button carries. */
  readonly cancelData: string
}

type Buttons = readonly OutboundButton[] | undefined

/** One message naming the step being run, plus the platform typing signal. Every write is
 *  best-effort: a chat that will not take the notice still gets the answer. */
export interface SlashNotice {
  /** Throttled on the trailing edge, and a no-op on a channel that cannot edit. Before the notice
   *  is revealed it only records the step, which is then the label the reveal paints. */
  readonly report: ProgressReporter
  /** Cancels a notice that was never earned; otherwise restores the opening label, or says the
   *  command was cancelled, so the answer is not preceded by a step that has already finished.
   *  Either way the keyboard goes. Idempotent. */
  stop(): Promise<void>
}

export function openSlashNotice(deps: SlashNoticeDeps, progressKey: string): SlashNotice {
  const { translate } = bindLocale(deps.locale)
  const label = translate(progressKey)
  const typing = createTypingIndicator({
    adapter: deps.adapter,
    logger: deps.logger,
    chatId: deps.chatId,
    typingEnabled: deps.settings.typingIndicator,
  })
  const relabels = canRelabel(deps)
  const buttons = buildCancelButtons(deps)
  // Without a cancel keyboard the notice says how to cancel, after whatever step it names.
  const stopHint = buttons === undefined ? ` ${translate('channel.progressStopHint')}` : ''
  const writer = createNoticeWriter(deps)

  let current = label
  let lastWriteAt = 0
  let revealTimer: ReturnType<typeof setTimeout> | undefined
  let relabelTimer: ReturnType<typeof setTimeout> | undefined

  const relabel = (): void => {
    relabelTimer = undefined
    lastWriteAt = performance.now()
    writer.rewrite(`${current}${stopHint}`, buttons)
  }

  // Paints whichever step is current when it fires, not the one that was current when the command
  // was accepted.
  revealTimer = setTimeout(() => {
    revealTimer = undefined
    writer.reveal(`${current}${stopHint}`, buttons)
  }, REVEAL_DELAY_MS)

  typing.set(true)

  return {
    report(key, params): void {
      current = translate(key, params)

      if (!(relabels && writer.isShown()) || relabelTimer !== undefined) {
        return
      }

      const dueInMs = deps.settings.midStreamThrottleMs - (performance.now() - lastWriteAt)

      if (dueInMs <= 0) {
        relabel()
        return
      }

      // Deferred rather than dropped: a burst of quick steps must still end on its last one, or the
      // notice names a step that finished long before the one actually running.
      relabelTimer = setTimeout(relabel, dueInMs)
    },

    async stop(): Promise<void> {
      typing.set(false)

      if (relabelTimer !== undefined) {
        clearTimeout(relabelTimer)
        relabelTimer = undefined
      }

      if (revealTimer !== undefined) {
        clearTimeout(revealTimer)
        revealTimer = undefined
      } else if (deps.signal.aborted) {
        writer.rewrite(translate('channel.cancelled'))
      } else if (relabels) {
        writer.rewrite(`${label}${stopHint}`)
      }

      await writer.settle()
    },
  }
}

function canRelabel(deps: SlashNoticeDeps): boolean {
  return (
    deps.settings.midStreamUpdates &&
    deps.adapter.capabilities.canEdit &&
    deps.adapter.edit !== undefined
  )
}

/** The one message and every write against it. Steps land seconds apart, so ordering beats
 *  immediacy: writes take turns on one tail, which is replaced rather than appended to. Neither
 *  `send` nor `edit` rejects, so the tail carries no rejection. */
interface NoticeWriter {
  /** Sends the notice for the first time. Called once, by the reveal timer. */
  reveal(text: string, buttons: Buttons): void
  /** Rewrites it — nothing to do when it was never sent, or already says this. A rewrite without
   *  buttons drops the keyboard, which is how the final text loses its cancel. */
  rewrite(text: string, buttons?: Buttons): void
  /** Whether the message exists to be rewritten. */
  isShown(): boolean
  settle(): Promise<void>
}

function createNoticeWriter(deps: SlashNoticeDeps): NoticeWriter {
  let messageId: string | null = null
  let shown: string | null = null
  let tail: Promise<void> = Promise.resolve()

  return {
    reveal(text, buttons): void {
      tail = tail.then(async () => {
        messageId = await send(deps, text, buttons)
        shown = messageId === null ? null : text
      })
    },

    rewrite(text, buttons): void {
      tail = tail.then(async () => {
        if (messageId === null || shown === text) {
          return
        }

        shown = text
        await edit(deps, { messageId, text, buttons })
      })
    },

    isShown: () => messageId !== null,
    settle: () => tail,
  }
}

/** `null` means the chat refused the notice; the command still runs, just without one. */
async function send(deps: SlashNoticeDeps, text: string, buttons: Buttons): Promise<string | null> {
  try {
    const ref = await deps.adapter.send({
      channel: deps.adapter.id,
      chatId: deps.chatId,
      text,
      replyToMessageId: deps.replyToMessageId,
      ...(buttons === undefined ? {} : { buttons }),
    })

    return ref.messageId
  } catch (err: unknown) {
    deps.logger.warn('slash.notice_open_failed', {
      channel: deps.adapter.id,
      err: formatErrForLog(err),
    })

    return null
  }
}

interface NoticeEdit {
  readonly messageId: string
  readonly text: string
  readonly buttons?: Buttons
}

async function edit(deps: SlashNoticeDeps, input: NoticeEdit): Promise<void> {
  try {
    await deps.adapter.edit?.({
      chatId: deps.chatId,
      messageId: input.messageId,
      text: input.text,
      ...(input.buttons === undefined ? {} : { buttons: input.buttons }),
    })
  } catch (err: unknown) {
    // The next step tries again; a failed relabel must never reach the command.
    deps.logger.debug('slash.notice_edit_failed', {
      channel: deps.adapter.id,
      err: formatErrForLog(err),
    })
  }
}
