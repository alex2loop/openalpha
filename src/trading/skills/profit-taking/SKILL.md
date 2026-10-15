---
name: profit-taking
description: Manages a position that is working: what the first target settles, what it does not, and the cost of taking profit in pieces. Use when a holding nears its target, or the operator asks to sell some.
metadata:
  version: "1.0.0"
---

# Profit taking

Use when a held position has reached its first target or has run past it. `exit-management` ranks the five reasons a position ends; this one answers only the fifth.

## What the system already does with a winner

The take-profit and the target are two different prices. On a market that trails its stop (VN shares, crypto, world gold), `takeProfitTranchePct` banks a share of the position at the take-profit and the rest rides the trailing stop: it has no fixed exit, and the target is only what the reward:risk is measured to. VN shares, long-horizon crypto and long-horizon world gold set the take-profit one risk unit above entry; the other short horizons set it at the target. A position already held gets the same split from the row's `takeProfitTranchePct`.

The trail is the only thing that moves the stop, from the first session, and never within one ATR of the last close. The plan never moves it to entry at the take-profit: measured on the stored boards, a stop pulled up to breakeven cut more winners than it saved, so recommending one contradicts the plan the record is scored on.

Domestic gold keeps no trail and closes the whole position at its target, because nothing protects a gain left running; its stop and target sit on the shop's buying price, so the dealer spread is already inside them. A fund is graded at its target and trimmed back to its planned weight rather than sold.

The stop only ever moves up, and a raise beyond the one the market applies is the operator's to decide, stated in words against a level they can see.

## Taking it in pieces has a price

Closing part of a winner raises the share of trades that end positive and smooths the run of outcomes, and it does so by shrinking the position exactly where the move went furthest. That is a real trade, not a free improvement: the largest winners are what pay for a run of losses, and a ladder makes them smaller.

Which side of that trade is right depends on the edge, and the operator's own record answers it rather than a rule of thumb:

- A **trend or momentum** thesis earns most of its return from the few positions that keep going. Cutting them early removes the part that pays.
- A **mean-reversion, value or event** thesis has a defined destination. There is nothing to run to, and holding past the target is a new position with no evidence behind it.
- `suggestion_track_record` reports how past calls resolved by conviction band. A band whose winners rarely travel past the first target is telling the operator to take the whole thing there.

## Costs the ladder pays twice

Every partial exit pays the spread and the commission again, and each market charges differently for the privilege: a VN sale returns cash only after settlement, so a laddered exit is also a laddered return of buying power, and domestic gold pays a dealer spread on both sides of every slice. Two exits in a wide-spread instrument can cost more than the difference the ladder was trying to capture. Say so when it is true.

## Discipline

- **Answer from the plan first.** Asked for a better take-profit, quote the row's `takeProfit`, `takeProfitTranchePct` and stop before anything else. An alternative is stated in risk units off that stop, never as a round number or a menu of strategies.

- **Never move the target out** because the position is working. A target raised mid-trade is a new trade with the old stop, and it is the same act as widening a stop with the sign flipped.
- **A new high is not a reason.** Wanting more is not evidence; name what changed in the thesis, or hold to the plan that is written down.
- **State a raise as a condition, not a number.** "Move the stop up under the last swing low" is checkable against structure the operator can see; a level invented here would compete with the one the pipeline validated.

## Output

Whether to close the tranche, close the whole position, or hold the rest - with the reason, the cost the exit pays, and where a raised stop would sit if the operator chooses to raise one.
