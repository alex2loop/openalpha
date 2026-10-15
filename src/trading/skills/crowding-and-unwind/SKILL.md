---
name: crowding-and-unwind
description: Reads who is already on this side of a trade and names what unwinds first. Use when a name has run hard, when positioning or margin is stretched, or before sizing a consensus trade.
metadata:
  version: "1.0.0"
---

# Crowding and unwind

Use when the case is sound and the question is who else already owns it.
Crowding does not make a thesis wrong. It decides how narrow the exit is.

## What the pipeline already decided - do not re-argue it

| Already applied | Where | Do not |
| --- | --- | --- |
| Crypto buy into funding >= +0.1%/8h (or a sale into <= -0.1%) is already one band lower | `crypto-crowding` stage | Lower again for funding. Cite the mark, then move on. |
| High VN turnover already scores bearish | `speculative-turnover`, ranks lower-is-bullish over 250 sessions | Re-penalise turnover in prose. |
| Extreme funding already reads bearish | `funding`, ranks lower-is-bullish | Call it a fresh finding. |
| A sold-into last session is flagged, not sized | `equity-vn-distribution` stage, caveat only | Treat it as a block or a size cut. It is timing. |

Double-counting a stage's decision is the most common way this skill is misused.

## The readings, and what each one actually says

| Reading | What it means | The disproving check | What it costs |
| --- | --- | --- | --- |
| `market-data.funding-crowded` with open interest above its window mean | The paying side is both crowded and growing. The first move against it liquidates that side. | Is OI rising, or is funding high on a shrinking book? A shrinking book is an unwind already underway. | Stop distance, not conviction - the band is already lowered. |
| `suggestion.crowded-side` | This trade joins the side that pays to hold. | None. It is measured, not inferred. | Already paid. State it in the thesis. |
| `market.distribution-session` on a buy | Sellers were the aggressors in the last settled session. | Is one session a pattern? Check whether the prior sessions in the window read the same way. | Entry timing only. Never the size. |
| `market.foreign-room-exhausted` | The foreign bid cannot get larger. The marginal buyer that carried the move is gone. | Who is the next marginal buyer, named? If the answer is "domestic retail", say so. | Target, not entry. |
| `speculative-turnover` bearish AND `high-proximity` bullish | The anchoring drift and the speculative crowd are the same flow. The published VN finding runs against turnover; the drift finding runs with the high. | Strip `high-proximity`. Does the case survive on quality, value and trend alone? | If it does not survive, the case is positioning, not a thesis. |
| Gold COT positioning in the brief | Speculative longs at an extreme. **No gold factor scores this** - `official-demand` abstains for want of a source. | Compare against the trailing year, not the last print. | Argues the stop, and nothing else. This is unscored evidence, so say it is your reading. |

## What is not crowding

- `foreign-flow` and `proprietary-flow` are **momentum-consistent, not contrarian**. Persistent 20-session foreign accumulation predicts positively here; reading it as crowding inverts a scored factor.
- The Fear & Greed index is **not** contrarian in this pipeline. It was measured over 40 sessions and 815 names, and reading it contrarian cancelled the momentum leg it repeats.
- A well-evidenced case that happens to be popular is not crowded. `behavioral-finance` owns that reasoning: naming a bias without the disproving check is itself a rhetorical move.

## The one sentence this skill has to produce

Not "this looks crowded", but: *if this turns, the first seller is X, and the exit is Y wide.*
Name the holder and name the width, or say the positioning is unreadable.
