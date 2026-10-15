---
name: exit-management
description: Decides whether a position the operator already holds should still exist and names which exit reason applies. Use when reviewing a holding, moving a stop, or answering hold-or-sell.
metadata:
  version: "1.0.0"
---

# Exit management

Use when the operator already owns the name and the question is whether to keep owning it. Opening a position is a separate decision with separate evidence; this skill never argues an entry.

## The five reasons a position ends

Rank them. Only one of them is about price.

1. **The thesis was invalidated.** A condition on the stored `invalidators` list came true, or the reason the position was opened stopped being a reason. This is the only exit that carries information; the rest are risk control.
2. **The stop was reached.** The market disagreed at a level chosen before the money was at stake.
3. **The window elapsed.** The plan closes a position that has reached neither level inside the outcome window, and the position has then spent its whole life proving nothing.
4. **The slot is worth more elsewhere.** A cap is binding, the reserve is short, or a better-evidenced candidate has nowhere to sit. That is portfolio arithmetic, not a verdict on the name.
5. **The target was reached.** `profit-taking` owns it: a winner arriving at its first target begins a decision rather than ending one.

When none of the five applies, the answer is a stated hold. Silence reads as an oversight.

## What is already decided

Entry, stop and target on a stored plan are computed from the market's own volatility policy and validated before they are written. Never restate them, move them, or offer alternatives - quoting one back is what makes a condition checkable, and that is their only use here. `exitDistances` reports how far the current mark sits from each holding's stop, and a holding whose latest plan prices no levels is reported as unwatched. Unwatched is not the same as safe, and the silence of a watch is never evidence.

The outcome window is stated on every plan and is the same boundary the track record scores that call against. It is stated but not watched: the stop and the target each arm an alert and the window arms nothing, so checking it is work only this reading does. Read it against the day the oldest open lot was acquired, which the portfolio row carries. A thesis whose catalyst has a nearer date implies a shorter window, and saying so is useful; nothing implies a longer one, because the call is graded at the window whatever the position does afterwards.

## A stop is a falsification condition, not a price

- **Never widen one.** Moving a stop away from price opens a larger position that nobody sized, at the moment the evidence is worst. A stop in the wrong place means the size was wrong.
- **It fires on the first trade through it.** Every plan tells the operator to leave it resting as a stop order, and the track record grades it the same way, so an intraday print through the level is the stop being reached. Waiting for the close is a looser rule than the one the call is scored on.
- **A stop is a request, not a guarantee.** It fills at the next available price. An overnight gap, a price band, and a liquidation cascade each break the link between the level and the fill; `vn-market-rules` says which of them applies to a VN name.
- **Whether a stop helps at all depends on the thesis.** Stop rules add return where returns trend or switch regime, and subtract it under a random walk or mean reversion, where they sell the low as a matter of mechanism rather than bad luck. So say which kind of thesis this is before leaning on the level: a momentum or trend holding honours its stop, while a value or mean-reversion holding is falsified by the accounts rather than by the price.

## Output

The exit reason by name, or an explicit hold with the reason it is still held. Where the reason is a broken thesis, quote the invalidator that came true. Never imply the system sells: every line is an instruction the operator carries out or ignores.
