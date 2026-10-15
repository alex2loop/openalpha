---
name: intrinsic-value
description: Values a business from owner earnings and states the margin of safety at today's price, as a range. Use when the question is fair value, whether a name is cheap, or the margin before a long hold.
metadata:
  version: "1.0.0"
---

# Intrinsic value

Use after `quality-screen` and `moat-analysis`, never instead of them: a value for a business that does not earn its cost of capital is a liquidation estimate, and this skill does not produce one. `vn-valuation` prices a name against its own history and its sector; this prices it against the cash it can hand its owners. The two should agree on direction. When they do not, say which one you trust and why.

## Owner earnings

The cash an owner could take out each year without impairing next year's earnings:

```
owner earnings = net income
               + depreciation, amortisation and other non-cash charges
               - maintenance capital expenditure
               - working capital the business must add to hold its volume
```

Every line is a filing line. Cite the statement and the period for each.

- **Maintenance versus growth capex.** Filings here report one line, "purchase of fixed assets". Split it and state the split: depreciation is the floor for maintenance in a business holding its volume; capex far above depreciation for several years is growth, and the growth must then show up in revenue or it was maintenance in disguise. Capex per year is in the ANNUAL ACCOUNTS evidence, and its free-cash flag names capex against depreciation across the trend; the split between them is still yours to state.
- **Working capital.** Receivables and inventory growing faster than revenue is capital the business consumes, and it comes off owner earnings. `quality-screen` question 2 will already have found it.
- **One-offs.** Revaluation gains, asset sales and financial income are stripped exactly as `vn-earnings-playbook` strips them from reported profit.

Use several years, not the latest. A single year of owner earnings on a cyclical business is the cycle.

## From earnings to value

Value is owner earnings capitalised at the return the operator requires, with growth limited to what the business can fund:

- **The required return is the operator's, never the model's.** Ask for it, or read it from the profile if it states one. Do not invent a discount rate; do not borrow one from another market.
- **Growth is bounded by reinvestment.** The business can grow no faster than the share of owner earnings it retains times the return it earns on what it retains, over the period the moat is expected to hold. `capital-allocation` supplies that incremental return. Growth assumed beyond it is a forecast about a business that does not yet exist.
- **Bank and insurer.** No owner earnings exist in this form; use `vn-valuation`'s book-value method and stop here.

## Margin of safety

State the value as a **range** - the required return and the growth bound each move it, and a range is what the inputs support. State today's price against that range as a fraction: how far below the low end, or how far above it. Never print one fair-value number; a point estimate becomes the operator's anchor, which is the bias `behavioral-finance` exists to name.

The margin the operator needs is theirs to set. The reference range value investors have used is a third to a half below the estimate, and the wider the range of inputs, the larger the margin the price must offer.

## What this changes and what it does not

A margin-of-safety buy still carries the stop and target the pipeline computes, and the operator decides. What this skill adds is the thesis kind: a name bought below its owner-earnings value is a value thesis, falsified by the accounts rather than by the price, which is what `exit-management` reads before it leans on the stop.

## Output

Owner earnings for each year used, with the maintenance capex split stated; the growth bound and where it came from; the value range; the margin at today's price; and one sentence on which input the range is most sensitive to.
