import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { Command } from '@/cli/command'
import type { McpHost, McpHostId } from '@/cli/commands/mcp/hosts'
import type { ParsedArgs } from '@/cli/parsing/args'
import type { SelfCommand } from '@/cli/services'
import type { CliApp } from '@/cli/types'
import { createCommand } from '@/cli/command'
import { buildHostAnalyst } from '@/cli/commands/mcp/analyst'
import { buildAddCommand, buildHostConfig } from '@/cli/commands/mcp/host-config'
import { DEFAULT_MCP_HOST, MCP_HOST_IDS, resolveMcpHost } from '@/cli/commands/mcp/hosts'
import { terminalErrorMessage } from '@/cli/error-output'
import { flagString } from '@/cli/parsing/args'
import { resolveConfigPath, resolveMcpSurface, resolveSelfCommand } from '@/cli/services'
import { hint, style } from '@/cli/ui/colors'
import { BRAND } from '@/core/brand'
import { expandHome } from '@/core/config/resolve'
import { ANALYST_AGENT_NAME, buildHostSkill } from '@/engine/api'
import { t } from '@/i18n'

const SKILL_FILE_NAME = 'SKILL.md'
const AGENT_FILE_EXTENSION = '.md'

export const mcpInstallCommand: Command = createCommand({
  name: 'install',
  summary: { key: 'cliHelp.mcpInstallSummary', params: { brand: BRAND.display } },
  needs: { modelSource: 'client' },
  spec: {
    flags: {
      host: { type: 'string', choices: MCP_HOST_IDS, describe: { key: 'cliHelp.flagMcpHost' } },
      skillDir: { type: 'string', describe: { key: 'cliHelp.flagMcpSkillDir' } },
    },
  },
  run: installIntoHost,
})

async function installIntoHost(args: ParsedArgs, app: CliApp): Promise<number> {
  const locale = app.config.locale.language
  const host = resolveMcpHost(resolveHostId(args))
  const skillDir = flagString(args, 'skillDir') ?? host.skill?.dir

  printServerConfig(app, host, resolveServerCommand(app))
  app.out('')
  app.out(style.heading(t(locale, 'cli.mcpInstallSkillHeading')))

  if (skillDir === undefined) {
    app.out(hint(t(locale, 'cli.mcpInstallNoSkill')))

    return 0
  }

  const path = join(expandHome(skillDir), BRAND.name, SKILL_FILE_NAME)

  try {
    const skill = buildHostSkill(await resolveMcpSurface(app).instructions())

    await writeHostFile(path, skill)
  } catch (err: unknown) {
    app.err(
      t(locale, 'cli.mcpInstallSkillFailed', { path, reason: terminalErrorMessage(err, locale) })
    )

    return 1
  }

  app.out(hint(t(locale, 'cli.mcpInstallSkillWritten', { path })))

  if (host.skill?.invocation !== undefined) {
    app.out(hint(t(locale, host.skill.invocation, { name: BRAND.name })))
  }

  return host.agent === undefined ? 0 : await installAnalyst(app, host.agent.dir)
}

async function installAnalyst(app: CliApp, agentDir: string): Promise<number> {
  const locale = app.config.locale.language
  const path = join(expandHome(agentDir), `${ANALYST_AGENT_NAME}${AGENT_FILE_EXTENSION}`)

  app.out('')
  app.out(style.heading(t(locale, 'cli.mcpInstallAgentHeading')))

  try {
    await writeHostFile(path, buildHostAnalyst())
  } catch (err: unknown) {
    app.err(
      t(locale, 'cli.mcpInstallAgentFailed', { path, reason: terminalErrorMessage(err, locale) })
    )

    return 1
  }

  app.out(hint(t(locale, 'cli.mcpInstallAgentWritten', { path })))

  return 0
}

function resolveHostId(args: ParsedArgs): McpHostId {
  const chosen = flagString(args, 'host')

  return chosen !== undefined && isMcpHostId(chosen) ? chosen : DEFAULT_MCP_HOST
}

function isMcpHostId(value: string): value is McpHostId {
  return MCP_HOST_IDS.includes(value)
}

function resolveServerCommand(app: CliApp): SelfCommand {
  const { command, args } = resolveSelfCommand()

  return { command, args: [...args, 'mcp', 'serve', '--config', resolveConfigPath(app)] }
}

/** The app's own add command first where it has one: it writes the file itself, so nothing can be
 *  pasted into the wrong place. */
function printServerConfig(app: CliApp, host: McpHost, server: SelfCommand): void {
  const locale = app.config.locale.language

  app.out(style.heading(t(locale, 'cli.mcpInstallServerHeading')))

  if (host.addCommand !== undefined) {
    app.out(hint(t(locale, 'cli.mcpInstallAddCommand')))
    app.out(buildAddCommand(host.addCommand, server))
    app.out('')
  }

  const fileKey =
    host.addCommand === undefined ? 'cli.mcpInstallConfigFile' : 'cli.mcpInstallConfigFileInstead'

  app.out(hint(t(locale, fileKey, { file: host.configFile })))
  app.out(buildHostConfig(host.format, server))
}

// A half-written file loads as a valid skill or agent with its rules truncated, so the body lands
// under a temp name in the destination directory and arrives whole or not at all.
async function writeHostFile(path: string, body: string): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`

  await mkdir(dirname(path), { recursive: true })

  try {
    await writeFile(temp, body, 'utf8')
    await rename(temp, path)
  } catch (err: unknown) {
    await rm(temp, { force: true }).catch(() => {
      // Cleanup must not mask the write error.
    })

    throw err
  }
}
