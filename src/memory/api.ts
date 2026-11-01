// Public API of memory/. Other modules import from here — never from memory/ internals.
// createMemory stays internal: memoryProvider is the only thing that builds it.
export type {
  Memory,
  MemoryEntry,
  MemoryImportance,
  MemoryListOptions,
  MemoryScope,
  MemoryScopeEntries,
  MemoryWrite,
} from '@/core/types/memory'
export { memoryProvider } from '@/memory/services'
export { MEMORY_SEARCH_LIMIT_MAX, resolveSearchLimit } from '@/memory/store'
