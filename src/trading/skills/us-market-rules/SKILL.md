---
name: us-market-rules
description: The mechanical rules of the US stock market that decide whether an order is possible and when proceeds are usable: sessions, ticks, settlement, pauses. Use before any US order, or when a fill looks impossible.
metadata:
  version: "1.0.0"
---

# US market rules

Use before proposing timing, a level, or a size for a US-listed stock or ETF. These rules are mechanical: breaking one makes an order impossible, not merely unwise.

## Sessions

The regular session runs 09:30 to 16:00 New York time. This analyst plans only for that session; pre-market, after-hours and overnight trading are out of scope, so a price printed outside it is not the price an order fills at. The market's own calendar is the authority, including full holidays and the 13:00 closes on the day after Thanksgiving, and on July 3 and December 24 when they trade. Do not infer a trading day or its close from the weekday alone.

## Ticks and price limits

Prices move in one-cent ticks, or a hundredth of a cent under one dollar. There is no daily price limit, so a stop can be gapped through: a name that opens below its stop fills at the open, not at the stop. Say so when a plan leans on a stop. Single names pause for a few minutes when they move too fast (limit up-limit down), and the whole market pauses at 7%, 13% and 20% drops in the S&P 500. A pause delays an order; it does not cancel one.

## Settlement

A sale settles in one business day (T+1). In a cash account the proceeds can still be used to buy the same day, and shares bought today can be sold today. Proceeds from a sale stay unsettled until the next business day. In a cash account, buying with them and selling that new position the same day, before the money settles, is a good-faith violation: three in twelve months restrict the account to settled cash for 90 days. When a plan sells one name to fund another and the new one may be sold again that day, say so and name the broker's rule rather than assuming one.

## Day trading

Since 2026-06-04 FINRA no longer sets a pattern-day-trader minimum balance. A broker may still apply its own rule, so check the account before advising several round trips in a week.

## Output

Before any timing advice, confirm: trading day, session state, tick validity, and whether the proceeds you are counting on have settled. Name the one that binds.
