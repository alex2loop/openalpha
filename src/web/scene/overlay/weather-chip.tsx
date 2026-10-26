import type { MessageKey } from '@/i18n'
import type { WeatherNow } from '@/web/scene/sky-types'
import { sceneZone } from '@/web/scene/clock/clock'
import { regionPack } from '@/web/scene/data/home'
import { raining, weather, weatherReadAt } from '@/web/scene/data/weather'
import { breakpoint } from '@/web/state/breakpoints'
import { DEGREE_C } from '@/web/text/glyphs'
import { formatClock } from '@/web/text/time'
import { tr } from '@/web/text/tr'
import { Chip } from '@/web/ui/kit/chip'
import { CloudIcon, FogIcon, RainIcon, StormIcon, SunIcon } from '@/web/ui/kit/icons'

import './weather-chip.css'

type Condition = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog'

// A sky this covered reads as cloudy.
const CLOUDY_FROM = 0.6
const LINE_BREAK = '\n'
const CONDITIONS: Readonly<
  Record<Condition, { readonly key: MessageKey; readonly icon: typeof SunIcon }>
> = Object.freeze({
  clear: { key: 'ui.office.weather.clear', icon: SunIcon },
  cloudy: { key: 'ui.office.weather.cloudy', icon: CloudIcon },
  rain: { key: 'ui.office.weather.rain', icon: RainIcon },
  storm: { key: 'ui.office.weather.storm', icon: StormIcon },
  fog: { key: 'ui.office.weather.fog', icon: FogIcon },
})

/** The city's weather beside the header clock: an icon and the temperature, only while a live
 *  reading shows and never on a phone. Its tip names the condition, the place and time read, and
 *  the source. */
export function WeatherChip() {
  const now = weather.value
  const readAt = weatherReadAt.value

  if (readAt === undefined || now.tempC === undefined || breakpoint.value === 'phone') {
    return null
  }

  const condition = CONDITIONS[conditionOf(now)]
  const label = tr(condition.key)
  const Icon = condition.icon
  const title = [
    label,
    tr('ui.office.weather.tip', {
      city: regionPack.value.city,
      time: formatClock(readAt, sceneZone.value),
    }),
    tr('ui.office.weather.attribution'),
  ].join(LINE_BREAK)

  return (
    <Chip title={title}>
      <span class="weather-icon" role="img" aria-label={label}>
        <Icon />
      </span>
      {tr('ui.office.weather.temp', { temp: Math.round(now.tempC), unit: DEGREE_C })}
    </Chip>
  )
}

function conditionOf(now: WeatherNow): Condition {
  if (now.thunder) {
    return 'storm'
  }

  if (raining()) {
    return 'rain'
  }

  if (now.fog) {
    return 'fog'
  }

  return now.cloud >= CLOUDY_FROM ? 'cloudy' : 'clear'
}
