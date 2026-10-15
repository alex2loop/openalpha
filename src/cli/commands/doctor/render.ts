import { fail, hint, style, success, warn } from '@/cli/ui/colors'
import { scrubCredentials } from '@/core/security/credentials'

import type { DoctorProbe } from './types'

const LABEL_WIDTH = 12

export function renderDoctorProbe(probe: DoctorProbe): string {
  const label = scrubCredentials(probe.name).padEnd(LABEL_WIDTH)
  const detail = scrubCredentials(probe.detail)

  if (probe.status === 'ok') {
    return `${success(label)} ${hint(detail)}`
  }

  if (probe.status === 'warn') {
    return `${warn(label)} ${hint(detail)}`
  }

  return `${fail(label)} ${style.error(detail)}`
}
