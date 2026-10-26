import { chime } from '@/web/state/prefs'

/** Two chimes never ring closer together than this. */
const CHIME_MIN_GAP_MS = 10_000
// A soft rising pair: each note's pitch, its length, how loud it peaks and how fast it swells.
const NOTES_HZ: readonly number[] = Object.freeze([660, 880])
const NOTE_S = 0.18
const PEAK_GAIN = 0.06
const ATTACK_S = 0.02
// An exponential fade cannot reach zero; this is silent.
const SILENT_GAIN = 0.0001
const GESTURES: readonly string[] = Object.freeze(['pointerdown', 'keydown'])

let context: AudioContext | undefined
let lastRungAt = Number.NEGATIVE_INFINITY

/** A browser plays sound only after a gesture: the first one while the chime is on opens the audio.
 *  The returned stop removes the listeners and closes the audio; idempotent. */
export function startChime(): () => void {
  const gestures = new AbortController()
  const onGesture = (): void => {
    if (chime.value) {
      openChimeAudio()
    }

    if (context !== undefined) {
      gestures.abort()
    }
  }

  for (const type of GESTURES) {
    document.addEventListener(type, onGesture, { signal: gestures.signal, capture: true })
  }

  return () => {
    gestures.abort()
    closeAudio()
  }
}

/** Opens the audio from a gesture (the operator turning the chime on); a browser without it stays
 *  silent. */
export function openChimeAudio(): void {
  if (context !== undefined) {
    return
  }

  try {
    context = new AudioContext()
  } catch {
    context = undefined
  }
}

/** Rings once when the chime is on, the audio is open and the last ring is old enough. */
export function ringChime(): void {
  const nowMs = performance.now()

  if (!chime.value || context === undefined || nowMs - lastRungAt < CHIME_MIN_GAP_MS) {
    return
  }

  lastRungAt = nowMs
  playNotes(context)
}

/** "Nghe thử": rings now, from the operator's click, whatever the gap. */
export function previewChime(): void {
  openChimeAudio()

  if (context !== undefined) {
    playNotes(context)
  }
}

function playNotes(audio: AudioContext): void {
  audio.resume().catch(() => undefined)

  NOTES_HZ.forEach((hz, index) => {
    const startAt = audio.currentTime + index * NOTE_S
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()

    oscillator.frequency.value = hz
    gain.gain.setValueAtTime(0, startAt)
    gain.gain.linearRampToValueAtTime(PEAK_GAIN, startAt + ATTACK_S)
    gain.gain.exponentialRampToValueAtTime(SILENT_GAIN, startAt + NOTE_S)
    oscillator.connect(gain).connect(audio.destination)
    oscillator.addEventListener(
      'ended',
      () => {
        oscillator.disconnect()
        gain.disconnect()
      },
      { once: true }
    )
    oscillator.start(startAt)
    oscillator.stop(startAt + NOTE_S)
  })
}

function closeAudio(): void {
  const open = context

  context = undefined
  open?.close().catch(() => undefined)
}
