import type { ProviderEntry } from '@/ai/api'
import type { ResolvedConfig, ResolvedModel } from '@/core/config/resolve'
import type { CheckName, DoctorStatus } from '@/core/types/doctor'
import type { Locale } from '@/core/types/locale'

export type { DoctorStatus } from '@/core/types/doctor'

export type DoctorEnvironment = Readonly<Record<string, string | undefined>>

export interface DoctorFinding {
  readonly status: DoctorStatus
  readonly detail: string
}

export interface DoctorProbe extends DoctorFinding {
  /** The row label, already in the operator's language. */
  readonly name: string
}

/** A row with the check that wrote it. */
export interface CheckedProbe extends DoctorProbe {
  readonly check: CheckName
}

/** What the checks any process can run read: no CLI app, so the daemon runs them too.
 *  `onlineExcept` keeps the named checks offline while `online` is on. */
export interface DoctorInput {
  readonly config: ResolvedConfig
  readonly env: DoctorEnvironment
  readonly locale: Locale
  readonly online: boolean
  readonly onlineExcept: ReadonlySet<CheckName>
}

export interface ResolvedProviderModel {
  readonly model: ResolvedModel
  readonly provider: ProviderEntry
}
