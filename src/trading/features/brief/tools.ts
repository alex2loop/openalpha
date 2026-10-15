import { z } from 'zod'

import type { ToolDefinition, ToolResult } from '@/core/tool'
import type { Locale } from '@/core/types/locale'
import type { BriefService, BriefSnapshot } from '@/trading/features/brief/types'
import type { BriefSectionResult, BriefSectionRow } from '@/trading/kernel/operator/brief-section'
import type { RegionSchema } from '@/trading/kernel/surface/surface'
import { createTool } from '@/core/tool'
import { LOCAL_TIME_RE } from '@/core/utils/time'
import { renderBriefText } from '@/trading/features/brief/render'
import { toAgentJson } from '@/trading/kernel/surface/agent-json'
import { invocationAddress, isManagedMutation } from '@/trading/kernel/surface/tool-approval'
import { resolveRenderContext, TOOL_SURFACE } from '@/trading/render/format'
import { renderRowValues } from '@/trading/render/section'
import { joinToolDetail, renderRegionName, renderToolAction } from '@/trading/render/tool-detail'

/** Section fields that state the operator's own money or return rather than a market's. A model reasons about
 *  the book in weights; the figure itself reaches the operator through `display`. */
const OPERATOR_ONLY_BRIEF_FIELDS: ReadonlySet<string> = new Set([
  'nav',
  'previousFlow',
  'losingReturnPct',
])

export function createBriefBuildTool(
  briefs: BriefService,
  regions: RegionSchema,
  timezone: string
): ToolDefinition {
  return createTool({
    name: 'brief_build',
    description:
      'Build the ordered morning market brief for one region: index range, breadth, sector rotation, foreign desk and proprietary flow, macro risk, and the watchlist changes since the last brief.',
    inputSchema: z.strictObject({
      region: regions,
      force: z
        .literal(true)
        .optional()
        .describe("Only when the operator asks for a fresh build: replaces today's stored brief."),
    }),
    capability: 'net',
    presentation: {
      label: 'Morning brief',
      emoji: '🌅',
      detail: (input, locale) => renderRegionName(locale, input.region),
    },
    async execute(args, ctx): Promise<ToolResult> {
      const now = Date.now()
      const result = await briefs.build({
        region: args.region,
        locale: ctx.locale,
        now,
        signal: ctx.signal,
        ...(args.force === undefined ? {} : { forced: args.force }),
      })

      if (result.kind !== 'ready') {
        return { content: toAgentJson(result), isError: false }
      }

      return {
        content: toAgentJson({ ...result, snapshot: agentSnapshot(result.snapshot, ctx.locale) }),
        isError: false,
        display: renderBriefText(
          ctx.locale,
          result.snapshot,
          resolveRenderContext(timezone, TOOL_SURFACE)
        ),
      }
    },
  })
}

/** The brief as its model reader gets it: every value written the way the brief prints it, so a
 *  share, a board price and a flow each arrive in the operator's own units, and the operator's own
 *  figures stay on their screen. */
function agentSnapshot(snapshot: BriefSnapshot, locale: Locale): unknown {
  return {
    ...snapshot,
    sections: snapshot.sections.map((section) => agentSection(section, locale)),
  }
}

function agentSection(section: BriefSectionResult, locale: Locale): unknown {
  if (section.status !== 'ready') {
    return section
  }

  return {
    ...section,
    rows: section.rows.map((row) =>
      renderRowValues(locale, withoutOperatorValues(row), section.currency)
    ),
  }
}

function withoutOperatorValues(row: BriefSectionRow): BriefSectionRow {
  return Object.fromEntries(
    Object.entries(row).filter(([field]) => !OPERATOR_ONLY_BRIEF_FIELDS.has(field))
  )
}

export function createBriefManageTool(briefs: BriefService, regions: RegionSchema): ToolDefinition {
  return createTool({
    name: 'brief_manage',
    description:
      'Shows, enables, or disables the scheduled morning brief for this chat. One operator has one brief, so enable replaces the previous schedule and disable needs no id. Use it when the operator asks to start, stop, or check their daily brief; use brief_build to produce one now.',
    // One operator gets one morning brief, so there is nothing to list and no id to disable by.
    inputSchema: z.discriminatedUnion('action', [
      z.strictObject({ action: z.literal('show').describe('Show the current brief schedule.') }),
      z.strictObject({
        action: z.literal('enable').describe('Enable a daily brief for one region.'),
        region: regions,
        sendTime: z
          .string()
          .regex(LOCAL_TIME_RE)
          .optional()
          .describe(
            'Local HH:mm in the region\'s market timezone, such as "07:30". Omit to use the configured default.'
          ),
      }),
      z.strictObject({ action: z.literal('disable').describe('Stop the daily brief.') }),
    ]),
    capability: 'read',
    requiresApproval: isManagedMutation,
    presentation: {
      label: 'Brief schedule',
      emoji: '🗓️',
      // Without the arm, enabling a brief and disabling one render the same line — including in
      // the approval prompt that gates both.
      detail: (input, locale) =>
        joinToolDetail([
          renderToolAction(locale, input.action),
          input.action === 'enable' ? renderRegionName(locale, input.region) : undefined,
        ]),
    },
    async execute(args, ctx): Promise<string> {
      if (args.action === 'show') {
        return toAgentJson(await briefs.find(ctx.signal))
      }

      if (args.action === 'disable') {
        const result = await briefs.disable({ now: Date.now(), signal: ctx.signal })

        return toAgentJson({ action: 'disable', result })
      }

      const result = await briefs.enable({
        region: args.region,
        delivery: invocationAddress(ctx),
        ...(args.sendTime === undefined ? {} : { sendTime: args.sendTime }),
        now: Date.now(),
        signal: ctx.signal,
      })

      return toAgentJson(result)
    },
  })
}
