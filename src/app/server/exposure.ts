import type { ApiRouteContext } from '@/app/types'
import type { App } from '@/core/container'
import type { Runner, RunOptions } from '@/engine/api'
import { isApiChannel } from '@/app/server/channel'
import { isClientApprovalWithheld } from '@/engine/api'
import { type MessageKey, t } from '@/i18n'
import { ORDER_TOOL_NAME } from '@/trading/api'

/** Behind `public_url` nobody at the page is known to be the operator. */
export function isApiExposed(api: { readonly publicUrl?: string | undefined }): boolean {
  return api.publicUrl !== undefined
}

/** A server-only refusal's two sentences: the one naming the booted `public_url`, and the one for
 *  a `public_url` saved in `config.toml` that the running daemon has not booted with yet. */
interface ServerOnlyKeys {
  readonly booted: MessageKey
  readonly saved: MessageKey
}

export function buildServerOnlyText(
  ctx: ApiRouteContext,
  keys: ServerOnlyKeys,
  params: Readonly<Record<string, string>>
): string {
  const url = ctx.app.config.api.publicUrl
  const locale = ctx.app.config.locale.language

  return url === undefined
    ? t(locale, keys.saved, params)
    : t(locale, keys.booted, { ...params, url })
}

/** Limits every run on the app's channel - a chat, a steer, a job aimed at the app, and the
 *  delegate and research children that inherit its channel. Behind `public_url` nobody at the
 *  page is known to be the operator, so the tools whose approval a client program would answer
 *  are never offered; `[api] orders` off drops the order tool. */
export function withApiRunLimits(runner: Runner, app: App): Runner {
  const { orders } = app.config.api
  const exposed = isApiExposed(app.config.api)

  app.resolve('logger').info('api.run_limits', { exposed, orders })

  if (!exposed && orders) {
    return runner
  }

  let withheld: ReadonlySet<string> | undefined

  // The tool map is frozen at boot, so the withheld names are read once, on first use.
  const resolveWithheld = (): ReadonlySet<string> => {
    withheld ??= toWithheldNames(app, exposed, orders)

    return withheld
  }

  return {
    run: (input, options) =>
      isApiChannel(input.channel)
        ? runner.run(input, toLimitedOptions(app, options, resolveWithheld()))
        : runner.run(input, options),
  }
}

function toWithheldNames(app: App, exposed: boolean, orders: boolean): ReadonlySet<string> {
  const names = new Set<string>()

  if (exposed) {
    for (const [name, tool] of app.resolve('tools')) {
      if (isClientApprovalWithheld(name, tool)) {
        names.add(name)
      }
    }
  }

  if (!orders) {
    names.add(ORDER_TOOL_NAME)
  }

  return names
}

function toLimitedOptions(
  app: App,
  options: RunOptions | undefined,
  withheld: ReadonlySet<string>
): RunOptions {
  const requested = options?.allowedTools ?? [...app.resolve('tools').keys()]

  return { ...options, allowedTools: requested.filter((name) => !withheld.has(name)) }
}
