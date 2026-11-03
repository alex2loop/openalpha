// Bun/Node-only public API of engine/: user agents on disk, MCP stdio, skills, workflows and workspace
// cleanup. Only `app` and `cli` import it; the browser bundle never reaches this file.
export type { BuildUserAgentsDeps, UserAgentSource } from '@/engine/agents/user'
export type { McpConnection } from '@/engine/mcp/connect'
export type { WorkflowStop } from '@/engine/workflows/scheduled'
export { buildUserAgents, readUserAgents, userAgentFile, userAgentsDir } from '@/engine/agents/user'
export { connectServer } from '@/engine/mcp/connect'
export { createSkillCatalog } from '@/engine/skills/catalog'
export { ensureSkillsDirectory, resolveSkillsDir } from '@/engine/skills/dirs'
export { readLock, resolveLockPath, writeLock } from '@/engine/skills/lockfile'
export { addWorkflow, loadUserWorkflows, loadWorkflowToml } from '@/engine/workflows/discover'
export { startScheduledWorkflows } from '@/engine/workflows/scheduled'
export {
  applyWorkspaceScratchCleanup,
  planWorkspaceScratchCleanup,
  pruneExpiredRunCaches,
  pruneExpiredWorkspaceTmp,
} from '@/engine/workspace/cleanup'
