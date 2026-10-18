import { lruMap } from '@/core/utils/collections'

// An entry is about 100 bytes, so the map stays around 200 KB.
const SENT_MESSAGE_CAPACITY = 2_000

export type SentMessage =
  | { readonly kind: 'answer'; readonly hasFooter: boolean }
  | { readonly kind: 'notice'; readonly label: string }

/** Kinds only, never text, and gone after a restart: a lost entry costs a reply its context. */
export interface SentMessages {
  record(chatId: string, messageId: string, message: SentMessage): void
  get(chatId: string, messageId: string): SentMessage | undefined
}

export function createSentMessages(): SentMessages {
  const sent = lruMap<string, SentMessage>(SENT_MESSAGE_CAPACITY)

  return {
    record: (chatId, messageId, message) => sent.set(sentKey(chatId, messageId), message),
    get: (chatId, messageId) => sent.get(sentKey(chatId, messageId)),
  }
}

// Telegram numbers messages per chat, so the pair is the identity.
function sentKey(chatId: string, messageId: string): string {
  return `${chatId}:${messageId}`
}
