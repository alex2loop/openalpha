---
name: vn-execution
description: Turns an approved VN idea into an executable order the operator can actually place. Use when sizing, timing, or placing a VN equity order.
metadata:
  version: "1.0.0"
---

# VN execution

Use once an idea has passed the pipeline and the question is how to place it. `vn-market-rules` carries the constraints this one assumes.

## Sequence

1. **Confirm the market is open and the name is tradeable.** Session state, band headroom, and any halt. If not, the answer is a condition, not an order.
2. **Round to structure.** Size down to a whole board lot; move the entry to a valid tick. Round the size *down* - rounding up quietly breaches the position cap.
3. **Check settled cash.** A buy funded by an unsettled sale is not placeable today.
4. **Check liquidity against the intended size.** Compare the order to recent average traded value, not to a single day's spike. An order that is a large share of normal daily value will move the price against the operator, and that impact is a real cost the risk-reward did not include.
5. **Split when size demands it.** State the split explicitly - the operator places the orders, so a vague "scale in" is not actionable.

## Order type

Limit orders by default: a market order in a thin VN name pays the spread and any gap in the book. Use the session's matching mechanics deliberately - opening and closing periods match differently from continuous trading, and an order placed into the wrong one gets a price the analysis did not assume.

## What is not a reason to wait

- **A fund's routine notices.** An ETF publishes its swap basket, its NAV and a change in listed units almost every session as units are created and redeemed. That is housekeeping, not an event, and a wait for it to end never ends.
- **Price adjustment.** Every price and level here is already adjusted for dividends, bonus shares and rights issues. There is nothing to confirm.
- **A wait with no level.** A wait names what it checks and where it clears, read from the evidence: a close above the 50-session average, a close above the recent high. "Wait for a dip" or "wait for normal volume" names nothing, and a wait nobody can check never clears.

## What execution advice must never do

- Never restate or move the entry, stop, or target. Those are computed and validated upstream; describe conditions in words instead.
- Never imply the system places an order. It does not, structurally. Every output is an instruction for the operator to carry out or ignore.

## Output

The instrument, the rounded size in lots, the limit price on a valid tick, the session window, and the single condition that would cancel the order.
