import type { ToolDefinition } from '@/core/tool'
import type { SocialService } from '@/social/service'
import { createSocialRequestTool } from '@/social/tools/request-tool'
import { createSocialSkillTool } from '@/social/tools/skill-tool'

export function createSocialTools(service: () => SocialService): readonly ToolDefinition[] {
  return [createSocialRequestTool(service), createSocialSkillTool(service)]
}
