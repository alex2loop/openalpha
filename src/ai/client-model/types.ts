import type { JsonOutputContract } from '@/core/llm'

export interface ClientModelMessage {
  readonly role: 'user' | 'assistant'
  readonly text: string
}

export interface ClientModelRequest {
  readonly id: string
  /** The output contract's name, which for a debate persona is its role. */
  readonly role: string
  readonly system: string
  readonly messages: readonly ClientModelMessage[]
  readonly output?: Pick<JsonOutputContract, 'name' | 'schema'>
  readonly maxTokens: number
}

export type ClientModelRequestDraft = Omit<ClientModelRequest, 'id'>

export interface ClientModelAnswer {
  readonly text: string
  /** Self-reported by the client. */
  readonly model: string
}

export interface ClientModelBroker {
  post(
    jobId: string,
    request: ClientModelRequestDraft,
    signal: AbortSignal
  ): Promise<ClientModelAnswer>
}
