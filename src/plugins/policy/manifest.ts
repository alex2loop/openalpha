import { join } from 'node:path'

import { parse } from 'smol-toml'
import { z } from 'zod'

import type {
  DeclarativeChannelSource,
  DeclarativeSlashCommandSource,
  McpToolSource,
} from '@/core/types/plugin'
import { channelId } from '@/core/channels'
import { OperatorConfigError } from '@/core/config/resolve'
import { agentId, isPathId } from '@/core/ids'
import { isSlashCommandName } from '@/core/utils/text'

const CommandSchema = z.discriminatedUnion('target', [
  z.strictObject({
    name: z.string().refine(isSlashCommandName),
    description: z.string().min(1),
    target: z.literal('agent'),
    agent: z.string().refine(isPathId),
    prompt: z.string().min(1),
  }),
  z.strictObject({
    name: z.string().refine(isSlashCommandName),
    description: z.string().min(1),
    target: z.literal('workflow'),
    workflow: z.string().min(1),
  }),
])

const ChannelSchema = z.strictObject({
  adapter: z.string().refine(isPathId),
  config: z.record(z.string(), z.unknown()),
})

const McpToolSchema = z.strictObject({
  server: z.string().min(1),
  tool: z.string().min(1),
})

const PluginManifestSchema = z.strictObject({
  id: z.string().refine(isPathId).optional(),
  name: z.string().optional(),
  version: z.string().optional(),
  commands: z.array(CommandSchema).optional(),
  channels: z.array(ChannelSchema).optional(),
  tools: z.array(McpToolSchema).optional(),
})

type ParsedManifest = z.infer<typeof PluginManifestSchema>

type ParsedCommand = Exclude<ParsedManifest['commands'], undefined>[number]

type PluginManifestRead =
  | { readonly kind: 'missing' }
  | { readonly kind: 'invalid'; readonly reason: string }
  | { readonly kind: 'valid'; readonly manifest: PluginManifest }

export interface PluginManifest {
  readonly id?: string
  readonly name?: string
  readonly version?: string
  readonly commands?: readonly DeclarativeSlashCommandSource[]
  readonly channels?: readonly DeclarativeChannelSource[]
  readonly tools?: readonly McpToolSource[]
}

export async function readPluginManifest(dir: string): Promise<PluginManifestRead> {
  const file = Bun.file(join(dir, 'plugin.toml'))

  if (!(await file.exists())) {
    return { kind: 'missing' }
  }

  try {
    return { kind: 'valid', manifest: parsePluginToml(await file.text()) }
  } catch (err: unknown) {
    return { kind: 'invalid', reason: err instanceof Error ? err.message : 'unreadable manifest' }
  }
}

export function parsePluginToml(content: string): PluginManifest {
  const value: unknown = parse(content)
  const parsed = PluginManifestSchema.safeParse(value)

  if (!parsed.success) {
    throw new OperatorConfigError(formatManifestIssue(parsed.error), {
      key: 'errors.pluginManifestInvalid',
      params: { detail: formatManifestIssue(parsed.error) },
    })
  }

  return toPluginManifest(parsed.data)
}

function toPluginManifest(parsed: ParsedManifest): PluginManifest {
  return {
    ...(parsed.id === undefined ? {} : { id: parsed.id }),
    ...(parsed.name === undefined ? {} : { name: parsed.name }),
    ...(parsed.version === undefined ? {} : { version: parsed.version }),
    ...(parsed.commands === undefined ? {} : { commands: parsed.commands.map(toCommandSource) }),
    ...(parsed.channels === undefined
      ? {}
      : {
          channels: parsed.channels.map((source) => ({
            adapter: channelId(source.adapter),
            config: source.config,
          })),
        }),
    ...(parsed.tools === undefined ? {} : { tools: parsed.tools }),
  }
}

function toCommandSource(command: ParsedCommand): DeclarativeSlashCommandSource {
  if (command.target === 'agent') {
    return {
      name: command.name,
      description: command.description,
      target: { kind: 'agent', id: agentId(command.agent), prompt: command.prompt },
    }
  }

  return {
    name: command.name,
    description: command.description,
    target: { kind: 'workflow', id: command.workflow },
  }
}

function formatManifestIssue(error: z.ZodError): string {
  const issue = error.issues[0]

  return issue === undefined ? 'invalid manifest' : `${issue.path.join('.')}: ${issue.message}`
}
