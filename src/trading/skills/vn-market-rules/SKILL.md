---
name: vn-market-rules
description: The mechanical rules of the VN market that decide whether an order is even possible: lots, limits, settlement, foreign room. Use before any VN order, or when a fill looks impossible.
metadata:
  version: "1.0.0"
---

# VN market rules

Use before proposing timing, a level, or a size for a VN-listed instrument. These rules are mechanical: violating one makes an order impossible, not merely unwise.

## Sessions

The board runs a morning session, a lunch break, and an afternoon session, ending with a closing period whose mechanics differ by exchange. Nothing trades during the break, and an "urgent" action proposed at that time cannot be executed. The market's own calendar - including public holidays and any exchange-announced closure - is the authority; do not infer a trading day from the weekday alone.

## Price band

Each exchange applies a daily band around the reference price. Price cannot print outside it. Two consequences that matter more than the rule itself:

- A stop below the lower band cannot fill on that day at all. The position is locked, not protected.
- A name at the band with unmatched size on one side is effectively untradeable in that direction until the band resets.

Boards apply their own band widths, and a name's first day after a corporate action or a new listing uses different rules. Read the market's declared policy rather than assuming a number.

## Lots and ticks

Orders trade in board lots; odd lots follow a separate, less liquid route. Prices move in ticks that vary by price level. A proposed entry that is not on a valid tick, or a size that is not a whole number of lots, is not an order. The pipeline enforces both from the market manifest - your job is to not propose something it must then round away.

## Settlement

Sales settle after a fixed number of sessions, and proceeds are not available cash until they do. Buying against unsettled proceeds is a real constraint the ledger models. When advising a switch, say explicitly that the funds are unavailable until settlement.

## Foreign ownership

Many names carry a foreign ownership limit. A name at its limit cannot be bought by a foreign account regardless of price, and the available room changes daily.

## Index rebalance sessions

FTSE GEIS reviews take effect after the third Friday of March, June, September and December; the VN30 review takes effect on the first Monday of February and August and trades the session before. On the eve and the session itself, price action in index constituents is passive flow at the close, not information. Do not read a run into the date as conviction, and expect the sessions after to give part of it back. The pipeline refuses new buys on the session; your job is to say so plainly when the evidence shows a name that ran into it.

## Output

Before any timing advice, confirm: trading day, session state, band headroom, lot and tick validity, settled cash availability. Name the one that binds.
