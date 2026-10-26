import {
  ACESFilmicToneMapping,
  type Color,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  Fog,
  HemisphereLight,
  type Material,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type MeshStandardMaterialParameters,
  MeshToonMaterial,
  NearestFilter,
  PCFShadowMap,
  PMREMGenerator,
  RedFormat,
  type Scene,
  type Texture,
  Vector3,
  Vector4,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

import type { SunView } from '@/web/scene/sky-types'
import type { FloorId, RoomId } from '@/web/scene/types'
import {
  type LightKey,
  lightKeyOf,
  NIGHT_BASE,
  roomLevelOf,
  setRoomFill,
} from '@/web/scene/render3d/light-model'
import { toUnits } from '@/web/scene/render3d/space'
import { CLOSED_ROOM } from '@/web/scene/sprites/daylight'
import { roomsOn } from '@/web/scene/world/rooms'

/** Every material the 3D office draws with; each instanced one reads its room at the instance. */
export interface Materials {
  readonly floor: MeshStandardMaterial
  readonly lit: MeshStandardMaterial
  readonly litI: MeshStandardMaterial
  readonly glass: MeshStandardMaterial
  readonly curtain: MeshStandardMaterial
  readonly unlitI: MeshBasicMaterial
  readonly toon: MeshToonMaterial
}

/** The lights, the room environment and the rooms' fill uniforms; `key` is the light now, eased
 *  toward the hour's. */
export interface Lighting {
  readonly materials: Materials
  readonly renderer: WebGLRenderer
  readonly scene: Scene
  readonly hemi: HemisphereLight
  readonly sun: DirectionalLight
  readonly fog: Fog
  readonly uniforms: RoomUniforms
  readonly factors: Map<RoomId, number>
  readonly disposables: readonly { dispose(): void }[]
  key: LightKey | undefined
}

/** What the lights follow this frame. */
interface LightSpec {
  readonly floor: FloorId
  readonly lit: ReadonlySet<RoomId>
  /** How bright the lamps burn: 1 untouched, less over the lunch nap. */
  readonly lampGlow: number
  readonly sun: SunView
  readonly cloud: number
  readonly rain: number
  /** The office is quiet: every light keeps `QUIET_SHARE` of itself. */
  readonly isQuiet: boolean
  /** The home market is shut for the day: its lobby keeps `CLOSED_SHARE` of its fill. */
  readonly isClosed: boolean
  /** A lightning flash's strength now, 0 to 1. */
  readonly flash: number
  readonly dtMs: number
  readonly isReduced: boolean
}

interface RoomUniforms {
  readonly uRoomK: { value: Vector3[] }
  readonly uRoomRect: { value: Vector4[] }
  readonly uRoomBase: { value: Vector3 }
}

const ROOM_SLOTS = 8
// Far outside the floor: an unused slot matches no point.
const NO_ROOM = 1e9
// The sun is well under the horizon: the night levels hold.
const NIGHT_FROM_DEG = -6
// A room's fill starts under the north wall's band.
const ROOM_FROM_PX = 28
const QUIET_SHARE = 0.82
// The mockup's cel bands, shade to lit, as bytes of the toon gradient.
const TOON_BANDS = [80, 150, 215] as const
const CLOSED_SHARE = 0.86
const FLASH_HEMI = 1.8
const ROOM_FILL_EASE_MS = 100
const LIGHT_EASE_MS = 450
const SETTLED = 0.002
const ROUGHNESS = 0.9
const GLASS = Object.freeze({ opacity: 0.34, roughness: 0.25 })
const CURTAIN = Object.freeze({ tone: '#CFE6FF', opacity: 0.12, roughness: 0.1 })
const ENV_BLUR = 0.04
// One modest shadow map over the floor, from the sun's place round the floor's centre.
const SHADOW = Object.freeze({
  mapPx: 1024,
  reach: 32,
  near: 1,
  far: 160,
  bias: -0.0006,
  normalBias: 0.04,
})
const FLOOR_CENTRE = Object.freeze({ x: 20, z: 12 })
const FOG = Object.freeze({ near: 72, far: 160 })

export function createLighting(scene: Scene, renderer: WebGLRenderer): Lighting {
  const uniforms: RoomUniforms = {
    uRoomK: { value: Array.from({ length: ROOM_SLOTS }, () => new Vector3(1, 1, 1)) },
    uRoomRect: {
      value: Array.from(
        { length: ROOM_SLOTS },
        () => new Vector4(NO_ROOM, NO_ROOM, NO_ROOM, NO_ROOM)
      ),
    },
    uRoomBase: { value: new Vector3(1, 1, 1) },
  }
  const environment = createEnvironment(renderer)
  const gradient = createToonGradient()
  const materials = createMaterials(uniforms, { gradient, environment: environment.texture })
  const hemi = new HemisphereLight(0xffffff, 0xffffff, 1)
  const sun = createSun()
  const fog = new Fog(0xffffff, FOG.near, FOG.far)

  renderer.toneMapping = ACESFilmicToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFShadowMap
  // Only the furniture casts, and it never moves: the map is drawn again when the sun or the floor
  // moves, not every frame.
  renderer.shadowMap.autoUpdate = false
  scene.fog = fog
  scene.add(hemi, sun, sun.target)

  return {
    materials,
    renderer,
    scene,
    hemi,
    sun,
    fog,
    uniforms,
    factors: new Map(),
    disposables: [...Object.values(materials), gradient, environment],
    key: undefined,
  }
}

/** Eases the light toward the hour's key and each room's fill toward its lamp; true while one
 *  still moves. */
export function syncLighting(lighting: Lighting, spec: LightSpec): boolean {
  const isNight = spec.sun.altitudeDeg < NIGHT_FROM_DEG
  const isKeyEasing = syncKey(lighting, spec)
  let isEasing = false

  roomsOn(spec.floor).forEach((room, slot) => {
    const closed = spec.isClosed && room.id === CLOSED_ROOM ? CLOSED_SHARE : 1
    const level = roomLevelOf(room, { lit: spec.lit, lampGlow: spec.lampGlow, isNight }) * closed
    const held = lighting.factors.get(room.id) ?? level
    const next =
      spec.isReduced || Math.abs(level - held) < SETTLED
        ? level
        : ease(held, level, spec.dtMs / ROOM_FILL_EASE_MS)
    const { x, y, w, h } = room.rect

    isEasing ||= next !== level
    lighting.factors.set(room.id, next)
    setRoomFill(lighting.uniforms.uRoomK.value[slot], { room, fill: next, isNight })
    lighting.uniforms.uRoomRect.value[slot]?.set(
      toUnits(x),
      toUnits(y + ROOM_FROM_PX),
      toUnits(x + w),
      toUnits(y + h)
    )
  })
  clearSlots(lighting, roomsOn(spec.floor).length)
  lighting.uniforms.uRoomBase.value.setScalar(isNight ? NIGHT_BASE : 1)

  return isEasing || isKeyEasing
}

/** A lit material of its own that dims and brightens with its room, as the shared ones do, for a
 *  surface that changes apart from the rest; the caller disposes it. */
export function createRoomMaterial(
  lighting: Lighting,
  params: MeshStandardMaterialParameters
): MeshStandardMaterial {
  return withPatch(
    new MeshStandardMaterial({
      roughness: ROUGHNESS,
      envMap: lighting.materials.lit.envMap,
      envMapIntensity: lighting.materials.lit.envMapIntensity,
      ...params,
    }),
    roomPatch(lighting.uniforms, false),
    'room'
  )
}

// The hour's key under the sky and the quiet office, eased over about half a second (at once
// under reduced motion); the flash adds to the sky light without easing.
function syncKey(lighting: Lighting, spec: LightSpec): boolean {
  const target = lightKeyOf(spec.sun, { cloud: spec.cloud, rain: spec.rain })
  const held = lighting.key
  const k = spec.isReduced || held === undefined ? 1 : 1 - Math.exp(-spec.dtMs / LIGHT_EASE_MS)
  const key = held === undefined ? target : easeKey(held, { target, k })
  const quiet = spec.isQuiet ? QUIET_SHARE : 1

  lighting.key = key
  lighting.hemi.color.copy(key.sky)
  lighting.hemi.groundColor.copy(key.ground)
  lighting.hemi.intensity = key.hemi * quiet + FLASH_HEMI * spec.flash
  lighting.sun.color.copy(key.sun)
  lighting.sun.intensity = key.sunI * quiet
  const sunX = FLOOR_CENTRE.x + key.at[0]
  const sunZ = FLOOR_CENTRE.z + key.at[2]
  const { position } = lighting.sun

  if (position.x !== sunX || position.y !== key.at[1] || position.z !== sunZ) {
    position.set(sunX, key.at[1], sunZ)
    lighting.renderer.shadowMap.needsUpdate = true
  }

  lighting.renderer.toneMappingExposure = key.exposure
  lighting.fog.color.copy(key.top).lerp(key.bottom, 0.5)

  for (const material of [
    lighting.materials.lit,
    lighting.materials.litI,
    lighting.materials.floor,
  ]) {
    material.envMapIntensity = key.env * quiet
  }

  return !isSameKey(key, target)
}

function easeKey(held: LightKey, at: { readonly target: LightKey; readonly k: number }): LightKey {
  const { target, k } = at
  const step = (from: number, to: number): number =>
    Math.abs(to - from) < SETTLED ? to : from + (to - from) * k
  const tone = (from: Color, to: Color): Color => from.clone().lerp(to, k)

  return {
    sky: tone(held.sky, target.sky),
    ground: tone(held.ground, target.ground),
    hemi: step(held.hemi, target.hemi),
    env: step(held.env, target.env),
    sun: tone(held.sun, target.sun),
    sunI: step(held.sunI, target.sunI),
    exposure: step(held.exposure, target.exposure),
    at: [
      step(held.at[0], target.at[0]),
      step(held.at[1], target.at[1]),
      step(held.at[2], target.at[2]),
    ],
    top: tone(held.top, target.top),
    bottom: tone(held.bottom, target.bottom),
  }
}

function isSameKey(key: LightKey, target: LightKey): boolean {
  return (
    key.hemi === target.hemi &&
    key.sunI === target.sunI &&
    key.exposure === target.exposure &&
    key.at.every((value, i) => value === target.at[i]) &&
    key.sky.equals(target.sky) &&
    key.sun.equals(target.sun)
  )
}

function ease(held: number, target: number, steps: number): number {
  return held + (target - held) * (1 - Math.exp(-steps))
}

function clearSlots(lighting: Lighting, from: number): void {
  for (let slot = from; slot < ROOM_SLOTS; slot++) {
    lighting.uniforms.uRoomRect.value[slot]?.set(NO_ROOM, NO_ROOM, NO_ROOM, NO_ROOM)
  }
}

// The sun casts the floor's one shadow map, aimed at the floor's centre.
function createSun(): DirectionalLight {
  const sun = new DirectionalLight(0xffffff, 1)
  const camera = sun.shadow.camera

  sun.castShadow = true
  sun.shadow.mapSize.set(SHADOW.mapPx, SHADOW.mapPx)
  sun.shadow.bias = SHADOW.bias
  sun.shadow.normalBias = SHADOW.normalBias
  camera.left = -SHADOW.reach
  camera.right = SHADOW.reach
  camera.top = SHADOW.reach
  camera.bottom = -SHADOW.reach
  camera.near = SHADOW.near
  camera.far = SHADOW.far
  sun.target.position.set(FLOOR_CENTRE.x, 0, FLOOR_CENTRE.z)

  return sun
}

// The soft all-round fill of a room environment, prefiltered once; the generator goes at once.
function createEnvironment(renderer: WebGLRenderer): {
  readonly texture: Texture
  dispose(): void
} {
  const generator = new PMREMGenerator(renderer)
  const room = new RoomEnvironment()

  try {
    const target = generator.fromScene(room, ENV_BLUR)

    return { texture: target.texture, dispose: () => target.dispose() }
  } finally {
    room.dispose()
    generator.dispose()
  }
}

function createToonGradient(): DataTexture {
  const texture = new DataTexture(new Uint8Array(TOON_BANDS), TOON_BANDS.length, 1, RedFormat)

  texture.minFilter = NearestFilter
  texture.magFilter = NearestFilter
  texture.needsUpdate = true

  return texture
}

function createMaterials(
  uniforms: RoomUniforms,
  maps: { readonly gradient: DataTexture; readonly environment: Texture }
): Materials {
  const patch = roomPatch(uniforms, false)
  const standard = (params: MeshStandardMaterialParameters): MeshStandardMaterial =>
    new MeshStandardMaterial({ roughness: ROUGHNESS, envMap: maps.environment, ...params })

  return {
    floor: withPatch(standard({}), patch, 'room-floor'),
    lit: withPatch(standard({ vertexColors: true }), patch, 'room'),
    litI: withPatch(standard({ vertexColors: true }), roomPatch(uniforms, true), 'room-instanced'),
    glass: withPatch(
      standard({
        vertexColors: true,
        transparent: true,
        opacity: GLASS.opacity,
        depthWrite: false,
        roughness: GLASS.roughness,
      }),
      patch,
      'room'
    ),
    curtain: standard({
      color: CURTAIN.tone,
      transparent: true,
      opacity: CURTAIN.opacity,
      depthWrite: false,
      roughness: CURTAIN.roughness,
      side: DoubleSide,
    }),
    unlitI: new MeshBasicMaterial({ toneMapped: false }),
    toon: withPatch(
      new MeshToonMaterial({ vertexColors: true, gradientMap: maps.gradient }),
      patch,
      'room-toon'
    ),
  }
}

function withPatch<T extends Material>(
  material: T,
  patch: (shader: WebGLProgramParametersWithUniforms) => void,
  key: string
): T {
  material.onBeforeCompile = patch
  material.customProgramCacheKey = () => key

  return material
}

// Every lit surface is multiplied by its room's fill: the fragment's world position is tested
// against the room rectangles, so a room dims or brightens on its own.
function roomPatch(
  uniforms: RoomUniforms,
  isInstanced: boolean
): (shader: WebGLProgramParametersWithUniforms) => void {
  const place = isInstanced ? 'instanceMatrix * ' : ''

  return (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = `varying vec3 vRoomAt;\n${shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>\nvRoomAt = (modelMatrix * ${place}vec4(transformed, 1.0)).xyz;`
    )}`
    shader.fragmentShader = `varying vec3 vRoomAt;
uniform vec3 uRoomK[${ROOM_SLOTS}];
uniform vec4 uRoomRect[${ROOM_SLOTS}];
uniform vec3 uRoomBase;
vec3 roomFill(vec3 p) {
  vec3 k = uRoomBase;
  for (int i = 0; i < ${ROOM_SLOTS}; i++) {
    vec4 r = uRoomRect[i];
    if (p.x >= r.x && p.x < r.z && p.z >= r.y && p.z < r.w) k = uRoomK[i];
  }
  return k;
}
${shader.fragmentShader.replace(
  '#include <opaque_fragment>',
  'outgoingLight *= roomFill(vRoomAt);\n#include <opaque_fragment>'
)}`
  }
}
