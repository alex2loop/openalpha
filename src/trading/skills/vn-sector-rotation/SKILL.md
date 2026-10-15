---
name: vn-sector-rotation
description: Reads VN sector leadership from flow and breadth without turning a two-week move into a regime. Use for sector-strength, rotation, or which-sector asks on the VN market.
metadata:
  version: "1.0.0"
---

# VN sector rotation

Use when reading which VN sectors are leading, and when a sector's weight is the question rather than a name's.

## What drives VN sector leadership

- **Policy.** Credit growth targets, public investment disbursement, and land or energy regulation move whole sectors faster than any earnings cycle.
- **Rates.** Banks, real estate, and leveraged industrials respond first and most.
- **Commodity inputs.** Steel, chemicals, and utilities are input-cost stories before they are demand stories.
- **Foreign flow.** Concentrated in large caps and index constituents; sustained foreign selling suppresses a sector regardless of its fundamentals.
- **Domestic retail.** Dominates turnover and drives mid-cap momentum, including its reversals.

## How to read it

1. Compare sector relative performance over multiple windows. Leadership visible only in a two-week window is noise.
2. Check breadth inside the sector. A sector index carried by one or two names is not rotation.
3. Check turnover. Leadership on rising turnover is participation; on falling turnover it is drift.
4. Separate foreign from proprietary and retail flow where the data allows - they mean different things.

## Applying it

Rotation is context for candidate selection and for reading concentration, not a signal by itself. A name is not a buy because its sector is leading, and a holding is not a sell because its sector lags. Where rotation does bind is the sector cap: leadership that has quietly pushed one sector against `maximumSectorPctNav` is a rebalance finding.

## Discipline

Sector labels are not exposures. Two names in the same sector can have opposite drivers, and names in different sectors can share one - and only the first of those is capped. Use `correlation-analysis` for anything that affects sizing.

## Output

Current leadership with the window it is measured over, the breadth check, the driver, and whether any sector cap is now binding.
