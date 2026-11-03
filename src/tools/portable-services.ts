import type { App, ServiceProvider } from '@/core/container'
import type { ToolDefinition } from '@/core/tool'
import type { WebRetrievalService } from '@/tools/web/retrieval-service'
import { createFileRevisionGuard } from '@/tools/fs/file-revision-guard'
import { researchTool } from '@/tools/research'
import { calcTool } from '@/tools/system/calc'
import { nowTool } from '@/tools/system/now'

// The tools that touch no file, process or local network: a host with none of those (the browser
// worker) offers these and nothing else. The host builds the retrieval service, since only it knows
// how a page is fetched.
const PORTABLE_TOOLS: readonly ToolDefinition[] = [calcTool, nowTool, researchTool]

export function createPortableToolsProvider(
  webRetrieval: (app: App) => WebRetrievalService
): ServiceProvider {
  return {
    name: 'tools',
    register(bind): void {
      bind('fileRevisionGuard', createFileRevisionGuard)
      bind('webRetrieval', webRetrieval)
      bind('tools', () => new Map(PORTABLE_TOOLS.map((tool) => [tool.name, tool])))
    },
  }
}
