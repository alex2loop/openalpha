import { access } from 'node:fs/promises'

import type { CliApp } from '@/cli/types'
import type { Locale } from '@/core/types/locale'
import { terminalErrorMessage } from '@/cli/error-output'
import { t } from '@/i18n'

import type { DoctorProbe } from './types'

const CHECK_NAME = 'trading'

/** Composing the app opens the database, so a first run, which has none yet, waits rather than
 *  have a diagnostic create it. */
export async function probeComposition(app: CliApp, locale: Locale): Promise<DoctorProbe> {
  const { storage } = app.config

  if (storage.engine === 'sqlite' && !(await exists(storage.path))) {
    return { name: CHECK_NAME, status: 'warn', detail: t(locale, 'cli.doctorTradingAfterFirstRun') }
  }

  try {
    await app.configProbe?.assertComposes()

    return { name: CHECK_NAME, status: 'ok', detail: t(locale, 'cli.doctorTradingReady') }
  } catch (err: unknown) {
    return { name: CHECK_NAME, status: 'fail', detail: terminalErrorMessage(err, locale) }
  }
}

async function exists(path: string): Promise<boolean> {
  return await access(path).then(
    () => true,
    () => false
  )
}
