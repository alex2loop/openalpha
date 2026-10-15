---
name: crypto-execution
description: Turns an approved crypto idea into orders that hold while nobody is watching. Use when placing or resting a crypto order, setting an exit, or sizing on an exchange.
metadata:
  version: "1.0.0"
---

# Crypto execution

Use once a crypto idea has passed the pipeline and the question is how to place it. `crypto-analysis` carries the risk mechanics this one assumes.

The market never closes and the operator sleeps. Everything here follows from that: the exit has to be standing on the exchange before the operator walks away, and the entry has to be placed when the book is deep enough to fill it.

## Sequence

1. **Place the exit with the entry, not after it.** A stop that exists only as an intention is not protection at 03:00. Exchanges take the stop and the target as one exit pair, so both go on in the same instruction - for a resting entry, the moment it fills.
2. **Use one-cancels-other, good-til-cancelled.** The two exits are linked so a fill on one withdraws the other; without that link a filled target leaves a live stop that can sell a position the operator no longer holds. Good-til-cancelled is what carries them across days rather than expiring at a session boundary this market does not have.
3. **Round to the exchange's own increments.** Price tick and quantity step differ per venue and per pair. An order rejected for a step violation is an unprotected position.
4. **Check the book against the intended size.** Compare the order to recent traded value on the venue being used, not to aggregated market volume - depth is per venue, and a size that is a large share of one book moves the price against the operator.
5. **Say what would cancel the order.** One condition, in words.
6. **Move the resting stop when the plan's stop moves.** The plan's stop trails the highest close every session; the exchange's does not. When `/portfolio` shows the stop above the resting order, amend the exit with `/trade exit` to the plan's level. Never down.
7. **A resting entry is a good-til-cancelled limit on the exchange.** When the plan's entry sits below the live price, place that limit as it stands and cancel it after the day the plan names. Never buy at market instead: the plan rests it because names this stretched have measured to give part of the run back.

## When to place

Liquidity is not flat across the day. The deepest books and tightest spreads are 13:00-17:00 UTC, when European and US hours overlap; the thinnest are roughly 00:00-06:00 UTC. The same order pays materially more in slippage in the thin window.

A morning brief in Vietnam is read around 01:00 UTC, which is inside the worst of it. Reading the suggestion then is fine; putting size on is better in the evening in Vietnam, which is the UTC overlap. Say this whenever size is large enough for slippage to matter, and expect thinner books on weekends. It is when to place the order, never a condition the idea waits on.

## What is not a reason to wait

Relative volume grades a breakout; it never times one. A close above the trigger on light volume is a weaker breakout, which argues for lower conviction, and waiting a session for volume was measured to buy only a higher entry. Wait on a close beyond the trigger or a dated event, never on volume or the clock.

## What execution advice must never do

- Never restate or move the entry, stop, or target. Those are computed and validated upstream; describe conditions in words instead.
- Never imply the system places an order. It does not, structurally. Every output is an instruction for the operator to carry out or ignore.
- Never present an exit as removing risk. A stop is filled at the market, and in a liquidation cascade that price can be well below the level.

## Output

The instrument, the size, the entry, the exit to attach it to, the venue window to place it in, and the single condition that would cancel the order.
