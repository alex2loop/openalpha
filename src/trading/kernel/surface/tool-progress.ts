import type { LocalizedMessageParam, ProgressMessage } from '@/core/stream-events'
import type { ToolInvocationContext } from '@/core/tool'
import type { MessageKey } from '@/i18n'

type StageParams = Readonly<Record<string, string | number | LocalizedMessageParam>>

/** Trading's narrowing of core's `ProgressReporter`, whose key is a bare string. Every stage key is
 *  a catalog key, so a missing translation is a compile error instead of a raw key at a surface.
 *  A supplier accepting the wider string still satisfies it. A param may itself be a keyed
 *  message, so a stage can name a registry value without holding a locale. */
export type StageReporter = (key: MessageKey, params?: StageParams) => void

/** A staged run is minutes of silence otherwise: the pipeline reports a key per stage, and the
 *  surface owns whether a spinner or a line shows it. Params travel with the key because a stage
 *  string names the instrument it belongs to - concurrent items are otherwise indistinguishable. */
export function reporterOf(ctx: ToolInvocationContext): StageReporter | undefined {
  const report = ctx.reportProgress

  if (report === undefined) {
    return undefined
  }

  return (key, params) => report(stageMessage(key, params))
}

function stageMessage(key: string, params?: StageParams): ProgressMessage {
  return { key, mode: 'transient', ...(params === undefined ? {} : { params }) }
}
