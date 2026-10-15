import type { ProviderEntry } from '@/ai/api'
import type { ResolvedModel } from '@/core/config/resolve'

export type DoctorEnvironment = Readonly<Record<string, string | undefined>>

export type DoctorStatus = 'ok' | 'warn' | 'fail'

export interface DoctorProbe {
  readonly name: string
  readonly status: DoctorStatus
  readonly detail: string
}

export interface ResolvedProviderModel {
  readonly model: ResolvedModel
  readonly provider: ProviderEntry
}
