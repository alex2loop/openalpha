import type { ToolDefinition } from '@/core/tool'
import { ValidationError } from '@/core/errors'
import { createTool } from '@/core/tool'
import { delegateTool } from '@/tools/delegation/delegate'
import { delegateParallelTool } from '@/tools/delegation/delegate-parallel'
import { fileEditTool } from '@/tools/fs/file-edit'
import { fileListTool } from '@/tools/fs/file-list'
import { fileReadTool } from '@/tools/fs/file-read'
import { fileSearchTool } from '@/tools/fs/file-search'
import { fileWriteTool } from '@/tools/fs/file-write'
import { memoryFtsRecallTool } from '@/tools/memory/memory-fts-recall'
import { memoryRecallTool } from '@/tools/memory/memory-recall'
import { memoryRemoveTool } from '@/tools/memory/memory-remove'
import { memoryStoreTool } from '@/tools/memory/memory-store'
import { researchTool } from '@/tools/research'
import { scheduleAddTool } from '@/tools/schedule/add'
import { scheduleListTool } from '@/tools/schedule/list'
import { scheduleRemoveTool } from '@/tools/schedule/remove'
import { shellExecTool } from '@/tools/shell/shell-exec'
import { askClarificationTool } from '@/tools/system/ask-clarification'
import { calcTool } from '@/tools/system/calc'
import { nowTool } from '@/tools/system/now'
import { skillViewTool } from '@/tools/system/skill-view'
import { todoWriteTool } from '@/tools/system/todo-write'
import { webSearchTool } from '@/tools/web/search/web-search'
import { webFetchTool } from '@/tools/web/web-fetch'

export const BUILT_IN_TOOLS: readonly ToolDefinition[] = [
  askClarificationTool,
  calcTool,
  nowTool,
  todoWriteTool,
  fileReadTool,
  fileWriteTool,
  fileEditTool,
  fileListTool,
  fileSearchTool,
  memoryStoreTool,
  memoryRecallTool,
  memoryRemoveTool,
  memoryFtsRecallTool,
  shellExecTool,
  webFetchTool,
  webSearchTool,
  scheduleAddTool,
  scheduleListTool,
  scheduleRemoveTool,
  skillViewTool,
  delegateTool,
  delegateParallelTool,
  researchTool,
] as const

assertToolList(BUILT_IN_TOOLS)

function assertToolList(tools: readonly ToolDefinition[]): void {
  const names = new Set<string>()
  for (const candidate of tools) {
    createTool(candidate)
    if (names.has(candidate.name)) {
      throw new ValidationError(`duplicate built-in tool: ${candidate.name}`)
    }
    names.add(candidate.name)
  }
}
