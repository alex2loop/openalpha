import { writeEnvFileValue } from '@/cli/env-file'
import { success } from '@/cli/ui/colors'
import { confirmDefaultYes, promptSecret } from '@/cli/ui/prompt'
import { t } from '@/i18n'

import type { AskContext } from './ask'
import { isEnvSet } from './model-step'

/** Offers to keep each unset key in the key file, so the first command after setup finds it. The
 *  names it saved come back as a set; the process environment is left as it was. */
export async function offerSaveKeys(
  ctx: AskContext,
  names: readonly (string | undefined)[]
): Promise<ReadonlySet<string>> {
  const saved = new Set<string>()
  const { path } = ctx.app.keyFile

  for (const name of new Set(names)) {
    if (name === undefined || isEnvSet(name)) {
      continue
    }

    const ask = t(ctx.locale, 'cli.onboardSaveKeyAsk', { name, path })

    if (!(await confirmDefaultYes(ctx.prompt, ask, ctx.locale))) {
      continue
    }

    const value = await promptSecret(t(ctx.locale, 'cli.keyPrompt', { name }))

    if (value === '') {
      continue
    }

    await writeEnvFileValue({ path, name, value })
    ctx.app.out(success(t(ctx.locale, 'cli.keySaved', { name, path })))
    saved.add(name)
  }

  return saved
}
