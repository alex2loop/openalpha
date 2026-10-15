---
name: portfolio-risk-analysis
description: Judges a candidate against the book that already exists, using weights and caps only. Use before any buy, add, or rebalance touches an existing portfolio.
metadata:
  version: "1.0.0"
---

# Portfolio risk analysis

Use when deciding whether an idea deserves a slot, and when reading a portfolio review.

## You see relative data only

Weights, percentage returns, settlement ratios, and caveats. You never see cash, NAV, or an absolute profit and loss - the agent-facing portfolio view has no field for one. Never reason about an amount, and never ask for one.

## The checks, in order

1. **Reserve.** Does the book still meet `reservePctNav` after this position? Reserve is the first claim on capital, not the leftover.
2. **Position cap.** Does the candidate's weight fit `maximumPositionPctNav` for its segment?
3. **Segment cap.** Does the segment stay inside `maximumSegmentPctNav` and its target?
4. **Sector cap.** `maximumSectorPctNav` applies across segments; two sleeves can breach one sector.
5. **Shared drivers.** No cap spans sectors, so use `correlation-analysis` to name any driver the candidate shares with a holding in another sector, and how much the book already carries on it.
6. **Liquidity.** Can the position be exited inside the configured maximum days-to-liquidate at realistic volume?
7. **Opportunity cost.** Name the holding this candidate has to beat - the one the book already owns with the best evidence in the same sleeve. If adding to that holding is the better use of the slot, the answer is a hold that says so. An idea is never judged alone; it is judged against more of what is already held.

A candidate that fails any check is a hold for that reason, named. Do not average the checks into a judgement.

## Drift and rebalancing

The rebalance band is the *tighter* of an absolute point band and a relative fraction of the target. A small sleeve therefore rebalances on a small absolute move; a large sleeve does not rebalance on a small relative one. Drift inside the band is not an action.

## Concentration is not always a fault

A deliberate, capped, well-evidenced concentration is a decision. Report it as concentration with its cap utilization, and let the operator judge. Flag it as a finding only when it breaches a cap or was not deliberate.

## Output

The binding constraint by name and its utilization. "Risky" without the constraint is not a finding.
