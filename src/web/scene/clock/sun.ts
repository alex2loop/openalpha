import type { SunView } from '@/web/scene/sky-types'
import { MINUTES_PER_DAY, MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from '@/web/text/time-units'

interface Geo {
  readonly lat: number
  readonly lon: number
}

// NOAA's solar position: Julian dates, then the sun's mean orbit terms in Julian centuries.
const UNIX_EPOCH_JD = 2_440_587.5
const J2000_JD = 2_451_545
const DAYS_PER_CENTURY = 36_525
const MINUTES_PER_DEGREE = 4
const HALF_DAY_MINUTES = MINUTES_PER_DAY / 2
const NOON_MS = 12 * MS_PER_HOUR
const DEG = Math.PI / 180

/** The sun over `geo` at `epochMs`, from the NOAA solar position formula (no refraction). */
export function sunAt(epochMs: number, geo: Geo): SunView {
  const { declination, eqTimeMin } = orbitAt(epochMs)
  const utcMinutes = (((epochMs % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY) / MS_PER_MINUTE
  const solarMinutes = mod(utcMinutes + eqTimeMin + MINUTES_PER_DEGREE * geo.lon, MINUTES_PER_DAY)
  const hourAngle = solarMinutes / MINUTES_PER_DEGREE - 180
  const lat = geo.lat * DEG
  const cosZenith = clampUnit(
    Math.sin(lat) * Math.sin(declination) +
      Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle * DEG)
  )
  const zenith = Math.acos(cosZenith)
  const sinZenith = Math.sin(zenith)
  const cosAzimuth =
    sinZenith === 0 || Math.cos(lat) === 0
      ? 1
      : clampUnit((Math.sin(lat) * cosZenith - Math.sin(declination)) / (Math.cos(lat) * sinZenith))
  const fromNorth = Math.acos(cosAzimuth) / DEG
  const azimuthDeg = hourAngle > 0 ? mod(fromNorth + 180, 360) : mod(540 - fromNorth, 360)

  return { altitudeDeg: 90 - zenith / DEG, azimuthDeg }
}

/** The epoch ms of solar noon over `geo` on the calendar `day` (`YYYY-MM-DD`). */
export function solarNoonOf(day: string, geo: Geo): number {
  const midnight = Date.parse(`${day}T00:00:00Z`)
  const { eqTimeMin } = orbitAt(midnight + NOON_MS)

  return midnight + (HALF_DAY_MINUTES - MINUTES_PER_DEGREE * geo.lon - eqTimeMin) * MS_PER_MINUTE
}

// The sun's declination (radians) and the equation of time (minutes) at `epochMs`.
function orbitAt(epochMs: number): { readonly declination: number; readonly eqTimeMin: number } {
  const t = (epochMs / MS_PER_DAY + UNIX_EPOCH_JD - J2000_JD) / DAYS_PER_CENTURY
  const meanLong = mod(280.46646 + t * (36_000.76983 + t * 0.0003032), 360) * DEG
  const anomaly = (357.52911 + t * (35_999.05029 - 0.0001537 * t)) * DEG
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
  const centre =
    Math.sin(anomaly) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * anomaly) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * anomaly) * 0.000289
  const omega = (125.04 - 1934.136 * t) * DEG
  const apparentLong = meanLong / DEG + centre - 0.00569 - 0.00478 * Math.sin(omega)
  const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
  const obliquity = (meanObliquity + 0.00256 * Math.cos(omega)) * DEG
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(apparentLong * DEG))
  const y = Math.tan(obliquity / 2) ** 2
  const eqTime =
    y * Math.sin(2 * meanLong) -
    2 * eccentricity * Math.sin(anomaly) +
    4 * eccentricity * y * Math.sin(anomaly) * Math.cos(2 * meanLong) -
    0.5 * y * y * Math.sin(4 * meanLong) -
    1.25 * eccentricity * eccentricity * Math.sin(2 * anomaly)

  return { declination, eqTimeMin: MINUTES_PER_DEGREE * (eqTime / DEG) }
}

function mod(value: number, by: number): number {
  return ((value % by) + by) % by
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, value))
}
