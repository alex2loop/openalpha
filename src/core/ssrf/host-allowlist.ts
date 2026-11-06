import { ToolError } from '@/core/errors'

// Enforce the agent-level allowlist. Absent or empty list = allow all. No DNS: a browser applies
// it too.
export function assertHostAllowlisted(
  hosts: readonly string[] | undefined,
  hostname: string
): void {
  if (hosts === undefined || hosts.length === 0) {
    return
  }

  const allowed = hosts.some((h) => isHostGlobMatch(h, hostname))

  if (!allowed) {
    throw new ToolError('host_blocked', `host ${hostname} is not in the agent allowlist`)
  }
}

// `*` matches every host; `*.example.com` the apex and every subdomain; anything else exactly.
export function isHostGlobMatch(pattern: string, hostname: string): boolean {
  if (pattern === '*') {
    return true
  }

  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1) // '.example.com'

    return hostname === pattern.slice(2) || hostname.endsWith(suffix)
  }

  return pattern === hostname
}
