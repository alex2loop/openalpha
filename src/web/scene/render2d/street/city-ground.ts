import type { CityScene } from '@/web/scene/render2d/street/city-blocks'
import { mixTone } from '@/web/scene/render2d/street/tone'
import { STREET_RECT } from '@/web/scene/view'

export const STREET_LEFT = STREET_RECT.x
export const STREET_RIGHT = STREET_RECT.x + STREET_RECT.w
export const STREET_BOTTOM = STREET_RECT.y + STREET_RECT.h

/** A daylight tone, the tone night brings it to, and how far night takes it. */
interface Tone {
  readonly day: string
  readonly night: string
  readonly share: number
}

/** The ground's tones, by day and by night. */
export const GROUND_TONES = Object.freeze({
  pave: { day: '#D9D4CA', night: '#2A3046', share: 0.8 },
  road: { day: '#7C8088', night: '#1E2230', share: 0.85 },
  kerb: { day: '#C9C3B6', night: '#222740', share: 0.8 },
  line: { day: '#F2EEE4', night: '#6A6E80', share: 0.5 },
  hedge: { day: '#6FB07E', night: '#1E3A2C', share: 0.8 },
  verge: { day: '#A8D6AE', night: '#2B4558', share: 0.8 },
  lawn: { day: '#9BD1A4', night: '#2B4558', share: 0.8 },
} satisfies Record<string, Tone>)

export function toneOf(scene: CityScene, tone: Tone): string {
  return mixTone(tone.day, tone.night, scene.dark * tone.share)
}

/** Fills `rect` (x, y, w, h in world px) with `tone` as the scene's darkness shows it. */
export function fillTone(
  scene: CityScene,
  tone: Tone,
  rect: readonly [number, number, number, number]
): void {
  scene.g.fillStyle = toneOf(scene, tone)
  scene.g.fillRect(rect[0], rect[1], rect[2], rect[3])
}
