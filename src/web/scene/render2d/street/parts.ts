import type { PaintPart, StreetMinute } from '@/web/scene/render2d/street/paint'
import type { PaintStep } from '@/web/scene/render2d/street/paint-run'
import type { RegionPack } from '@/web/scene/world/regions'
import { CITY_PART, SKY_PART } from '@/web/scene/render2d/street/city'
import { FESTIVE_PART } from '@/web/scene/render2d/street/festive'
import { FRONTAGE_PART } from '@/web/scene/render2d/street/frontage'
import { MOVERS_PART } from '@/web/scene/render2d/street/movers'
import { PARK_PART } from '@/web/scene/render2d/street/park'
import { SHELTERS_PART } from '@/web/scene/render2d/street/shelters'
import { SHOPS_PART } from '@/web/scene/render2d/street/shops'
import { SIGNALS_PART } from '@/web/scene/render2d/street/signals'
import { VENDORS_PART } from '@/web/scene/render2d/street/vendors'
import { WEATHER_PART } from '@/web/scene/render2d/street/weather'

type MovingPaint = NonNullable<PaintPart['paintMoving']>

// Every part of the street, in draw order.
const PAINT_PARTS: readonly PaintPart[] = [
  SKY_PART,
  CITY_PART,
  PARK_PART,
  SHOPS_PART,
  FRONTAGE_PART,
  FESTIVE_PART,
  SIGNALS_PART,
  SHELTERS_PART,
  VENDORS_PART,
  MOVERS_PART,
  WEATHER_PART,
]

/** What every part paints each step on the moving canvas, in draw order. */
export const MOVING_PAINTS: readonly MovingPaint[] = PAINT_PARTS.flatMap((part) =>
  part.paintMoving === undefined ? [] : [part.paintMoving]
)

/** The static paint of every part at `minute`, one step each, in draw order. */
export function staticStepsOf(pack: RegionPack, minute: StreetMinute): PaintStep[] {
  return PAINT_PARTS.map((part) => (g) => part.paintStatic(g, pack, minute))
}
