import { fail, hint, info, style, success, warn } from '@/cli/ui/colors'
import { scrubCredentials } from '@/core/security/credentials'

import type { DoctorProbe } from './types'

export function renderDoctorProbe(probe: DoctorProbe, labelWidth: number): string {
  const label = scrubCredentials(probe.name).padEnd(labelWidth)
  const detail = scrubCredentials(probe.detail)

  if (probe.status === 'ok') {
    return `${success(label)} ${hint(detail)}`
  }

  if (probe.status === 'info') {
    return `${info(label)} ${hint(detail)}`
  }

  if (probe.status === 'warn') {
    return `${warn(label)} ${hint(detail)}`
  }

  return `${fail(label)} ${style.error(detail)}`
}

export function labelWidthOf(probes: readonly DoctorProbe[]): number {
  return Math.max(0, ...probes.map((probe) => scrubCredentials(probe.name).length))
}
