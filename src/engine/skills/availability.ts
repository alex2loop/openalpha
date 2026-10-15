import type { SkillMeta } from '@/engine/skills/types'

const PLATFORM_NAMES: Readonly<Record<string, string>> = {
  darwin: 'macos',
  linux: 'linux',
  win32: 'windows',
  android: 'android',
}

export interface SkillVisibility {
  readonly allowed?: readonly string[] | undefined
  readonly tools: ReadonlySet<string>
  readonly platform: string
}

export function resolveSkillPlatform(platform: string): string {
  return PLATFORM_NAMES[platform] ?? platform
}

function isSkillAllowed(name: string, allowed: readonly string[] | undefined): boolean {
  return allowed === undefined || allowed.includes(name)
}

export function isSkillVisible(skill: SkillMeta, visibility: SkillVisibility): boolean {
  if (!isSkillAllowed(skill.name, visibility.allowed)) {
    return false
  }

  if (skill.platforms !== undefined && !skill.platforms.includes(visibility.platform)) {
    return false
  }

  if (skill.requiresTools?.some((tool) => !visibility.tools.has(tool)) === true) {
    return false
  }

  return skill.fallbackForTools?.some((tool) => visibility.tools.has(tool)) !== true
}
