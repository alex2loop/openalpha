import { BRAND } from '@/core/brand'

const SKILL_DESCRIPTION = `Answers trading questions - a trade idea, a market read, a portfolio review, or position sizing - through the ${BRAND.display} MCP server. Use when the user asks what to buy, whether to hold or reduce a position, how a market or ticker is trading, how their book stands, how to rebalance it, or for a morning brief.`

/** Only fields from the open Agent Skills spec, so every app reads the same file and a strict
 *  validator accepts it. Takes the same string the handshake sends rather than assuming the client
 *  read it: one that ignores `InitializeResult.instructions` would leave the model with no evidence
 *  rules and no skill catalog, and `skill_view` needs an exact name. */
export function buildHostSkill(instructions: string): string {
  const frontmatter = [
    `name: ${BRAND.name}`,
    `description: "${SKILL_DESCRIPTION}"`,
    `compatibility: Requires a configured ${BRAND.display} MCP server`,
    'metadata:',
    `  version: "${BRAND.version}"`,
  ].join('\n')

  // No argument placeholder: Claude Code appends what follows `/name` as `ARGUMENTS: ...`, and every
  // other app passes the question in the conversation, so one body serves them all.
  return `---
${frontmatter}
---

Answer the operator's question with the tools of the ${BRAND.name} MCP server.

## Routing

- An open-ended ask goes to \`market_screen\`, a sector ask to \`market_sector_strength\`.
- How a named ticker trades goes to \`market_price\`. A trade idea on it, or whether to hold or reduce it, goes to \`suggestion_run\`; a sweep of the watchlist or several names to \`suggestion_batch\`.
- A question about the book goes to \`portfolio_view\`, then \`portfolio_review\`; a rebalance to \`portfolio_rebalance\`.
- How past suggestions did goes to \`suggestion_track_record\`; a morning brief to \`brief_build\`.
- Which investment themes are forming or being tracked goes to \`themes_view\` (stored, no model call). It names no price: a trade idea on one of its names goes to \`suggestion_run\`, once the operator picks it.
- \`skill_view\` loads one of the research skills listed below, by its exact name.

## Rules

${instructions}
`
}
