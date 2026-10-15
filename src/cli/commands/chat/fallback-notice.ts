import type { CliApp } from '@/cli/types'
import { style } from '@/cli/ui/colors'
import { LOCAL_CHANNEL_ID } from '@/core/channels'
import { t, translateLlmErrorCode } from '@/i18n'

interface FallbackNotice {
  /** Prints one line per distinct switch. Call it before the footer, never during the run. */
  report(): void
  dispose(): void
}

/** Every other surface announces a provider switch; this is the CLI's. It reads the bus rather than
 *  the turn's stream because a debate persona runs as a child with its own session id, so its
 *  fallback never reaches the parent's printer — and the bus payload still names the channel the
 *  child inherited. Collected and printed once the work is done: a line written while the transient
 *  progress spinner owns the row would be painted over by the next frame. */
export function watchProviderFallbacks(app: CliApp): FallbackNotice {
  const locale = app.config.locale.language
  // Bounded by the configured chain: one entry pair per error code, and identical switches dedupe.
  const switched = new Set<string>()
  const off = app.resolve('bus').on('provider_fallback', (event) => {
    if (event.channel !== LOCAL_CHANNEL_ID) {
      return
    }

    switched.add(
      t(locale, 'ui.providerFallback', {
        from: event.from,
        to: event.to,
        reason: translateLlmErrorCode(locale, event.reason),
      })
    )
  })

  return {
    report(): void {
      for (const line of switched) {
        app.out(style.warn(line))
      }

      switched.clear()
    },
    dispose: off,
  }
}
