---
name: drawdown-response
description: Decides whether a position under water should be cut, held, or added to, judging the add as the new position it is. Use when a holding shows a loss or the operator asks whether to average down.
metadata:
  version: "1.0.0"
---

# Drawdown response

Use when a holding or a whole sleeve is under water. `exit-management` owns the exit itself; this one covers the harder half, which is the add.

## The only question

Would the operator open this position today, at this price, at this size, on today's evidence? The entry price is not information about the future and belongs in no part of the answer. Everything below is a way of answering that one question honestly.

## Three cases, and they are not the same

- **Price fell, thesis intact.** The evidence that opened the position still reads the way it did, and the fall is the market repricing rather than the case breaking. Holding is the plan. Adding is a separate decision, judged below.
- **Price fell, thesis damaged.** A load-bearing claim now reads weaker but is not refuted. Conviction falls; size does not rise. This is where a position is trimmed rather than closed.
- **Price fell, thesis broken.** An invalidator came true. The position ends at whatever price the market offers, and the loss already happened - closing only records it.

## An add into weakness is a new position

Judge it against the bar a fresh candidate faces, and then against two things a fresh candidate never has to answer:

1. **It concentrates.** The add raises weight in the name that is currently wrong. Run the caps - position, segment, sector - and name the driver it shares with anything else already held.
2. **It is the same call twice.** Averaging into a single name doubles one specific thesis. That is a different act from accumulating a broad tracker toward a declared weight, which is a schedule and carries no view at all; do not let the second borrow the first's justification.

An add that clears the bar is a buy with a reason. An add that exists to lower an average cost is loss aversion with arithmetic attached, and `behavioral-finance` names the check that disproves it.

## Never fund it from the reserve

Reserve is the first claim on capital, not the remainder. An add paid for by dropping below `reservePctNav` converts a bad position into a book that cannot act on the next one, which is how a single mistake becomes the whole outcome.

## Read the drawdown at book level too

Several positions falling together is usually one exposure, not several independent losses. Name the shared driver and the combined weight before treating any single line as its own problem; `correlation-analysis` owns that reasoning, and the caps will not do it for you.

## Output

The case by name, the verdict - cut, hold, trim, or add - and, for an add, the caps it consumes and the driver it doubles. "Down a lot" is not a finding.
