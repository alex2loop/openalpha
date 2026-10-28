/** Where the sun stands from the region's city: degrees above the horizon (below it negative)
 *  and the compass bearing, 0 north, 90 east. */
export interface SunView {
  readonly altitudeDeg: number
  readonly azimuthDeg: number
}

/** The weather the office keeps: rain 0 to 1 (0 when it is not raining), thunder, the air
 *  temperature when a reading gave one, cloud cover 0 to 1, fog, and whether it came from a live
 *  reading or the day's seed. */
export interface WeatherNow {
  readonly rain: number
  readonly thunder: boolean
  readonly tempC?: number
  readonly cloud: number
  readonly fog: boolean
  readonly source: 'live' | 'seeded'
}

/** The weather as the street and the windows show it: rain falling (0 under reduced motion or
 *  when dry), the rain itself for still pictures, fog, the heat habits, the last lightning strike
 *  (`performance.now()`, `-Infinity` for none) and the sim time the rain was last stepped to. */
export interface WeatherFxView {
  readonly falling: number
  readonly rain: number
  readonly fog: boolean
  readonly isHeat: boolean
  readonly flashAt: number
  readonly atMs: number
}

/** A glass side of the floor: west, east, north or south. */
export type GlassSide = 'w' | 'e' | 'n' | 's'

/** What the sun does at the glass, as the mockup's sky computes it: how far each side's blinds
 *  are drawn (only the west and east glass has them; 0 open to 1), how strong the warm patch the
 *  sun throws on the floor inside each side is (0 to 1), and how deep into the room it reaches
 *  (world px). From `windowLightOf` the patch is the sun's own, before the blinds cut it by
 *  `BLIND_CUT` of their closure. */
export interface WindowLight {
  readonly blind: Readonly<Record<'w' | 'e', number>>
  readonly patch: Readonly<Record<GlassSide, number>>
  readonly depth: Readonly<Record<GlassSide, number>>
}
