---
name: correlation-analysis
description: Decides whether two holdings are one bet by reasoning about shared exposure rather than a correlation number. Use when adding a name to a book that already holds its sector, factor, or currency.
metadata:
  version: "1.0.0"
---

# Correlation analysis

Use before adding a name to a book that already holds something similar, and whenever a rebalance suggestion looks like it is trimming diversification that was never there.

## Correlation is a conclusion, not an input

A trailing correlation coefficient is backward-looking and rises exactly when it matters least - in a drawdown, when everything moves together. Reason from shared exposure instead:

- **Same driver.** Two VN banks are one bet on credit growth and NIM, whatever the trailing correlation says.
- **Same input cost.** A steel maker and a construction firm share iron ore and coking coal in opposite directions; that is a hedge, not diversification.
- **Same customer.** Suppliers to a single dominant buyer are one credit exposure.
- **Same funding.** Companies rolling short-term debt in the same currency share a rate and FX shock.
- **Same flow.** Names in the same index basket move on foreign flow and ETF creation regardless of fundamentals.

## What the caps actually catch, and what they miss

Two ceilings are enforced deterministically after you reason, and you should know the shape of each:

- **Sector cap** - one ceiling per sector, as the instrument record files it. Two banks compete for the same sector allowance.
- **Segment cap** - one ceiling per asset class: VN equities, crypto, gold, cash.

Nothing caps exposure *across* sectors inside one asset class. Banks, brokers and property are three sectors riding one VN credit cycle, and a book can sit at the sector ceiling in each of them while every limit reads green. The same holds for a steel maker and a construction firm, or an exporter and a port operator.

That gap is yours to close. When a candidate shares a driver with something already held in a *different* sector, say so and say how much the book already carries on that driver - the caps will not.

## Cross-asset notes

- Domestic VN gold carries a premium over the global price. The premium is its own exposure - a policy and import-quota bet - and does not move with the global metal.
- Crypto behaves as a high-beta liquidity asset most of the time. Treat a crypto sleeve alongside high-beta equities as one liquidity bet, even though the segment caps price them separately.
- FX exposure hides inside foreign-listed holdings. A base-currency investor holding a USD-priced asset owns two positions.

## Output

State the shared driver in one clause, name the holdings that already carry it, and give their combined weight. "Correlated" without a named driver is not a finding.
