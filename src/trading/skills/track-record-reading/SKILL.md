---
name: track-record-reading
description: Reads a resolved track record for what its sample can support, and refuses the conclusions it cannot. Use when reporting past suggestion performance or calibrating conviction from it.
metadata:
  version: "1.0.0"
---

# Track record reading

Use when reading `/reflect` or `suggestion_track_record`. This grades a record that has already been resolved. It never recomputes one: outcome resolution, conviction band drift, and factor attribution each own their own arithmetic, and this skill only reads what they produced.

## Denominators first

Twenty resolved rows is the floor. Below it the report gives counts and withholds rates, which is the record saying a rate would be noise - not that a number is missing.

Every slice carries its own denominator, and reading a rate off the wrong one is the most common way to be confidently wrong here:

- `winRate` divides by `resolvedCount`.
- `benchmarkBeatRate` divides by `benchmarkComparedCount`, never by `resolvedCount`. A band of thirty rows where eight carry a benchmark reports a beat rate off eight.
- Each `calibration` bucket and each `versions` entry has its own `resolvedCount`, and each is subject to the same floor as the whole.
- `targetCount` on a `focuses` entry counts that focus's independent calls that closed on their target, out of the same `resolvedCount` as `winCount`. The floor withholds rates, never counts: below it, state `targetCount` of `resolvedCount` as the two numbers they are and never as a share.

The headline is blended across every market the operator trades, and the tool cannot slice it. VN equities, global gold, VN physical gold and crypto have different base rates, hold windows and volatility, so one win rate over all four describes no market in particular. Report it as blended and say so; never let it stand as a statement about the market being discussed.

## What each figure supports

| Figure | Supports | Does not support |
| --- | --- | --- |
| `winCount` / `lossCount` | How often calls resolve positive | Anything about magnitude. Seven wins in ten with a negative `meanReturnPct` is a losing process. |
| `targetCount` | How many calls reached the level the plan named | Whether the rest failed. A call can close at its stop or expire in profit, and only a target close counts here. |
| `meanReturnPct` vs `medianReturnPct` | Whether a few rows carry the record | A mean far above the median means one or two names are the record. Read the median. |
| `beatsBenchmarkMajority` | Whether the calls beat holding the index | Only over `benchmarkComparedCount`. Rows the market declined to benchmark are not losses. |
| `calibration` by band | Whether conviction means anything | A high band that does not outperform the medium band is decorative conviction, and it is a measurement rather than an argument. |
| `versions` | Whether the record describes the system that runs today | Rows under a superseded `strategyVersion` graded a different system. A record concentrated there is history, not calibration. |
| `shadow` | How much the calls would have moved a book that took every one at the size it named | It is a sequential contribution over `sizedCount` of n, not a return. No compounding, overlapping holds and cash drag unmodeled, `worstDrawdown` measured on that same series. |

## Process, not outcome

A resolved loss is not a process failure and a resolved win is not a validation. Grade the process on what was knowable when the call was made: a stated driver, a dated fact, a level that invalidates it, and room under the caps. A win from a call carrying none of those is the more expensive of the two results, because it is the one that gets repeated.

Only the aggregate grades a process. One row grades nothing, and the last three rows grade less than nothing.

## What this record cannot answer

- Whether an untaken suggestion would have filled. Resolution prices from bars and knows nothing of a price band, a gap through a stop, or a dealer spread.
- What to do with a position now. That is exit management, profit taking, or drawdown response.
- What size to use next time. Sizing ceilings come from the profile and the book, and no track record moves them.

## Output

Lead with the sample and its floor, then give at most three readings the sample actually supports, each carrying the denominator it came from. Where the sample cannot support a reading, name the figure that is short and stop. A record read past its sample is worse than no record, because it arrives with a number attached.
