import { z } from 'zod'

import type { ToolDefinition } from '@/core/tool'
import type { AgentProfile } from '@/trading/features/profile/types'
import type { ProfilePatch } from '@/trading/kernel/operator/profile'
import { createTool } from '@/core/tool'
import { renderPatchText } from '@/trading/features/profile/render'
import { SEGMENT_TOGGLES } from '@/trading/features/profile/types'
import { portfolioSegment } from '@/trading/kernel/instrument'
import { toAgentJson } from '@/trading/kernel/surface/agent-json'
import { noInput } from '@/trading/kernel/surface/surface'
import { renderDeclaredValue, SECTION_ICONS } from '@/trading/render/format'
import { joinToolDetail, renderToolAction } from '@/trading/render/tool-detail'

/** The profile's three agent tools: read it, patch its fields, and switch a sleeve. */
export function createProfileTools(
  profiles: AgentProfile,
  patch: z.ZodType<ProfilePatch>
): readonly ToolDefinition[] {
  return [
    createProfileViewTool(profiles),
    createProfileUpdateTool(profiles, patch),
    createProfileSegmentTool(profiles),
  ]
}

function createProfileUpdateTool(
  profiles: AgentProfile,
  patch: z.ZodType<ProfilePatch>
): ToolDefinition {
  return createTool({
    name: 'profile_update',
    description:
      'Update the saved investor profile. Takes one `patch` object holding only the fields that change: riskLevel (conservative|balanced|aggressive), horizons (one short|long per segment, e.g. {crypto:"short"}), goal (preserve|income|grow), exclusions, or a NAV limit. Risk is one answer or two, never both: send riskLevel alone, or riskCapacity with riskWillingness when what the operator can afford differs from what they want. Sending riskLevel also re-seeds every NAV limit to that level defaults, so name a limit in the same patch to keep it. Use watchlist_update for the watchlist; this tool cannot touch it. What the operator states about their own risk, horizons or goal is saved here, not merely used for the answer in hand.',
    inputSchema: z.strictObject({
      patch: patch.describe(
        'Only the profile fields that change; every other field is left alone.'
      ),
    }),
    capability: 'write',
    // Eager because the wrong tool is the visible one: memory_store sits in the eager set, and a
    // profile the operator states lands there as a note while sizing keeps reading the old values.
    // The operator is told it saved, so the loss is silent.
    eager: true,
    presentation: {
      label: 'Update profile',
      emoji: '✏️',
      detail: (input, locale) => renderPatchText(locale, input.patch),
    },
    async execute(args, ctx): Promise<string> {
      const profile = await profiles.update({
        patch: args.patch,
        defaultLocale: ctx.locale,
        signal: ctx.signal,
      })

      return toAgentJson(profile)
    },
  })
}

function createProfileViewTool(profiles: AgentProfile): ToolDefinition {
  return createTool({
    name: 'profile_view',
    description:
      'Returns the saved investor profile: risk level, horizon, goal, watchlist, and position caps. Use it before any suitability, sizing, or hold-or-sell answer, and before asking the operator for a fact it may already hold. Takes no input; use profile_update to change it.',
    inputSchema: noInput,
    capability: 'read',
    presentation: { label: 'Profile', emoji: '🪪' },
    async execute(_args, ctx): Promise<string> {
      const profile = await profiles.get({
        defaultLocale: ctx.locale,
        signal: ctx.signal,
      })

      return toAgentJson(profile)
    },
  })
}

/** Switching a sleeve is its own tool rather than a `profile_update` field: that patch is also the
 *  `/v1/profile` body, and a toggle re-seeds the targets the way `/profile enable|disable` does. */
function createProfileSegmentTool(profiles: AgentProfile): ToolDefinition {
  const segments = profiles.heldSegments().join(', ')

  return createTool({
    name: 'profile_segment',
    description:
      'Switch one portfolio sleeve on or off. Off means nothing in it is screened, sized or bought, and the other sleeves take over its target. Use it when the operator says which markets they trade; a new profile starts with its default sleeves on.',
    inputSchema: z.strictObject({
      action: z.enum(SEGMENT_TOGGLES).describe('enable switches the sleeve on, disable off.'),
      segment: z.string().describe(`The sleeve, one of: ${segments}.`),
    }),
    capability: 'write',
    presentation: {
      label: 'Switch sleeve',
      emoji: SECTION_ICONS.segments,
      detail: (input, locale) =>
        joinToolDetail([
          renderToolAction(locale, input.action),
          renderDeclaredValue(locale, `trading.segment.${input.segment}`),
        ]),
    },
    async execute(args, ctx): Promise<string> {
      const profile = await profiles.updateSegment({
        kind: args.action,
        segment: portfolioSegment(args.segment),
        defaultLocale: ctx.locale,
        signal: ctx.signal,
      })

      return toAgentJson(profile)
    },
  })
}
