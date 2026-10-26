import {
  BufferAttribute,
  Color,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  HemisphereLight,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshToonMaterial,
  NearestFilter,
  PlaneGeometry,
  RedFormat,
  type Scene,
  Vector3,
  Vector4,
  type WebGLProgramParametersWithUniforms,
} from 'three'

import type { FloorId, RoomId } from '@/web/scene/types'
import { toUnits } from '@/web/scene/render3d/space'
import { CLOSED_ROOM, type LightRow } from '@/web/scene/sprites/daylight'
import { TOON_BANDS } from '@/web/scene/sprites/palette'
import { FRAME_RECT } from '@/web/scene/view'
import { roomsOn } from '@/web/scene/world/rooms'

/** Every material the 3D office draws with; each instanced one reads its room at the instance. */
export interface Materials {
  readonly floor: MeshLambertMaterial
  readonly lit: MeshLambertMaterial
  readonly litI: MeshLambertMaterial
  readonly glass: MeshLambertMaterial
  readonly curtain: MeshLambertMaterial
  readonly unlitI: MeshBasicMaterial
  readonly toon: MeshToonMaterial
}

/** The lights, the rooms' fill uniforms and the sky behind the north glass. */
export interface Lighting {
  readonly materials: Materials
  readonly hemi: HemisphereLight
  readonly sun: DirectionalLight
  readonly sky: Mesh<PlaneGeometry, MeshBasicMaterial>
  readonly uniforms: RoomUniforms
  readonly factors: Map<RoomId, number>
  readonly disposables: readonly { dispose(): void }[]
  skyKey: string
}

/** What the lights follow this frame. */
interface LightSpec {
  readonly floor: FloorId
  readonly lit: ReadonlySet<RoomId>
  readonly lampGlow: number
  readonly isClosed: boolean
  readonly row: LightRow
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
// Lambert divides by pi: the sun and the sky together bring a lit top face to full colour.
const SUN_INTENSITY = 0.6 * Math.PI
const HEMI_INTENSITY = 0.5 * Math.PI
const SUN_AT = Object.freeze({ x: -12, y: 40, z: 30 })
const GROUND_TONE = '#C9C2D6'
// An unlit room's fill (the north rooms keep more of the glass's light), and a shut lobby's.
const FILL = Object.freeze({ unlitNorth: 0.8, unlitSouth: 0.66, closed: 0.86 })
const LIT_NIGHT_SHARE = 0.45
// A lamp dimmed over the nap keeps at least this much of its fill.
const LAMP_FLOOR = 0.82
// A tint at full alpha leaves this much of the daylight.
const TINT_DARKEST = 0.25
// The 3D light loses this much more than the 2D tint's alpha, which also colours.
const TINT_WEIGHT = 1.5
// The tint's own hue keeps this share against white in the light's colour.
const TINT_HUE_SHARE = 0.4
const TINT_RGB = /\d+,\d+,\d+/
const LIGHT_EASE_MS = 300
const SETTLED = 0.004
const GLASS_OPACITY = 0.34
const CURTAIN_OPACITY = 0.12
const CURTAIN_TONE = '#CFE6FF'
const SKY_PX = 320
const SKY_Z_PX = -6

export function createLighting(scene: Scene): Lighting {
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
  const gradient = createToonGradient()
  const materials = createMaterials(uniforms, gradient)
  const hemi = new HemisphereLight(0xffffff, GROUND_TONE, HEMI_INTENSITY)
  const sun = new DirectionalLight(0xffffff, SUN_INTENSITY)
  const sky = createSky()

  sun.position.set(SUN_AT.x, SUN_AT.y, SUN_AT.z)
  scene.add(hemi, sun, sky)

  return {
    materials,
    hemi,
    sun,
    sky,
    uniforms,
    factors: new Map(),
    disposables: [...Object.values(materials), gradient, sky.geometry, sky.material],
    skyKey: '',
  }
}

/** Eases each room's fill toward its lamp and the hour's light; true while one still moves. */
export function syncLighting(lighting: Lighting, spec: LightSpec): boolean {
  const darkness = darknessOf(spec.row)
  const tint = tintOf(spec.row)
  let isEasing = false

  lighting.hemi.color.copy(tint)
  lighting.sun.color.copy(tint)
  lighting.hemi.intensity = HEMI_INTENSITY * (1 - darkness)
  lighting.sun.intensity = SUN_INTENSITY * (1 - darkness)
  roomsOn(spec.floor).forEach((room, slot) => {
    const target = targetFill(room.id, room.rect.y === 0, { spec, darkness })
    const held = lighting.factors.get(room.id) ?? target
    const next =
      spec.isReduced || Math.abs(target - held) < SETTLED ? target : ease(held, target, spec.dtMs)
    const { x, y, w, h } = room.rect

    isEasing ||= next !== target
    lighting.factors.set(room.id, next)
    lighting.uniforms.uRoomK.value[slot]?.setScalar(next)
    lighting.uniforms.uRoomRect.value[slot]?.set(
      toUnits(x),
      toUnits(y),
      toUnits(x + w),
      toUnits(y + h)
    )
  })
  clearSlots(lighting, roomsOn(spec.floor).length)
  syncSky(lighting, spec.row.sky)

  return isEasing
}

// An unlit room keeps the daylight through its glass; a lit one's lamp makes up most of what the
// night takes, as the 2D tint keeps a share of it over a lit room.
function targetFill(
  room: RoomId,
  isNorth: boolean,
  at: { readonly spec: LightSpec; readonly darkness: number }
): number {
  const { spec, darkness } = at

  if (!spec.lit.has(room)) {
    return isNorth ? FILL.unlitNorth : FILL.unlitSouth
  }

  const lamp = LAMP_FLOOR + (1 - LAMP_FLOOR) * spec.lampGlow
  const closed = spec.isClosed && room === CLOSED_ROOM ? FILL.closed : 1

  return (lamp * closed * (1 - LIT_NIGHT_SHARE * darkness)) / (1 - darkness)
}

function ease(held: number, target: number, dtMs: number): number {
  return held + (target - held) * (1 - Math.exp(-dtMs / LIGHT_EASE_MS))
}

function clearSlots(lighting: Lighting, from: number): void {
  for (let slot = from; slot < ROOM_SLOTS; slot++) {
    lighting.uniforms.uRoomRect.value[slot]?.set(NO_ROOM, NO_ROOM, NO_ROOM, NO_ROOM)
  }
}

// The 2D tint's alpha, as a share of the daylight it takes away.
function darknessOf(row: LightRow): number {
  const alpha = Number(row.tint?.split(',').at(-1)?.replace(')', '') ?? 0)

  return Math.min(1 - TINT_DARKEST, alpha * TINT_WEIGHT)
}

function tintOf(row: LightRow): Color {
  const rgb = row.tint?.match(TINT_RGB)?.[0]

  return rgb === undefined
    ? new Color(0xffffff)
    : new Color(`rgb(${rgb})`).lerp(new Color(0xffffff), 1 - TINT_HUE_SHARE)
}

function syncSky(lighting: Lighting, sky: readonly [string, string]): void {
  const key = sky.join()

  if (lighting.skyKey === key) {
    return
  }

  const colors = lighting.sky.geometry.getAttribute('color')
  const [top, bottom] = sky.map((hex) => new Color(hex))

  for (let v = 0; v < colors.count; v++) {
    const tone = v < 2 ? top : bottom

    colors.setXYZ(v, tone?.r ?? 1, tone?.g ?? 1, tone?.b ?? 1)
  }

  colors.needsUpdate = true
  lighting.skyKey = key
}

// A tall plane behind the north glass, its top the sky's top colour and its foot the horizon's.
function createSky(): Mesh<PlaneGeometry, MeshBasicMaterial> {
  const geometry = new PlaneGeometry(toUnits(FRAME_RECT.w), toUnits(SKY_PX))
  const material = new MeshBasicMaterial({
    vertexColors: true,
    toneMapped: false,
    side: DoubleSide,
  })
  const sky = new Mesh(geometry, material)

  geometry.setAttribute('color', new BufferAttribute(new Float32Array(4 * 3).fill(1), 3))
  sky.position.set(toUnits(FRAME_RECT.x + FRAME_RECT.w / 2), toUnits(SKY_PX / 2), toUnits(SKY_Z_PX))

  return sky
}

function createToonGradient(): DataTexture {
  const texture = new DataTexture(
    new Uint8Array(TOON_BANDS.map((band) => Math.round(band * 255))),
    TOON_BANDS.length,
    1,
    RedFormat
  )

  texture.minFilter = NearestFilter
  texture.magFilter = NearestFilter
  texture.needsUpdate = true

  return texture
}

function createMaterials(uniforms: RoomUniforms, gradient: DataTexture): Materials {
  const patch = roomPatch(uniforms, false)
  const lit = withPatch(new MeshLambertMaterial({ vertexColors: true }), patch, 'room')
  const litI = withPatch(
    new MeshLambertMaterial({ vertexColors: true }),
    roomPatch(uniforms, true),
    'room-instanced'
  )
  const glass = withPatch(
    new MeshLambertMaterial({
      vertexColors: true,
      transparent: true,
      opacity: GLASS_OPACITY,
      depthWrite: false,
    }),
    patch,
    'room'
  )
  const curtain = new MeshLambertMaterial({
    color: CURTAIN_TONE,
    transparent: true,
    opacity: CURTAIN_OPACITY,
    depthWrite: false,
    side: DoubleSide,
  })
  const toon = withPatch(
    new MeshToonMaterial({ vertexColors: true, gradientMap: gradient }),
    patch,
    'room-toon'
  )

  const floor = withPatch(new MeshLambertMaterial(), patch, 'room-floor')

  return {
    floor,
    lit,
    litI,
    glass,
    curtain,
    unlitI: new MeshBasicMaterial({ toneMapped: false }),
    toon,
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
