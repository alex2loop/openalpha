import type { ProviderEntry } from '@/ai/api'
import type { ResolvedModel } from '@/core/config/resolve'

export type DoctorEnvironment = Readonly<Record<string, string | undefined>>

/** `info` is a state that needs no action yet (a fresh install, a daemon not started), so it never
 *  counts against the report. */
export type DoctorStatus = 'ok' | 'info' | 'warn' | 'fail'

export interface DoctorFinding {
  readonly status: DoctorStatus
  readonly detail: string
}

export interface DoctorProbe extends DoctorFinding {
  /** The row label, already in the operator's language. */
  readonly name: string
}

export interface ResolvedProviderModel {
  readonly model: ResolvedModel
  readonly provider: ProviderEntry
}
