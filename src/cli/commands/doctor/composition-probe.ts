import { access } from 'node:fs/promises'

import type { CliApp } from '@/cli/types'
import type { Locale } from '@/core/types/locale'
import { terminalErrorMessage } from '@/cli/error-output'
import { t } from '@/i18n'

import type { DoctorProbe } from './types'
import { checkLabel } from './labels'

/** Composing the app opens the database, so a first run, which has none yet, waits rather than
 *  have a diagnostic create it. */
export async function probeComposition(app: CliApp, locale: Locale): Promise<DoctorProbe> {
  const { storage } = app.config
  const name = checkLabel(locale, 'trading')

  if (storage.engine === 'sqlite' && !(await exists(storage.path))) {
    return { name, status: 'info', detail: t(locale, 'cli.doctorTradingAfterFirstRun') }
  }

  try {
    await app.configProbe?.assertComposes()

    return { name, status: 'ok', detail: t(locale, 'cli.doctorTradingReady') }
  } catch (err: unknown) {
    return { name, status: 'fail', detail: terminalErrorMessage(err, locale) }
  }
}

async function exists(path: string): Promise<boolean> {
  return await access(path).then(
    () => true,
    () => false
  )
}
