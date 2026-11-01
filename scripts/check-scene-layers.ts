#!/usr/bin/env bun
// Scene layers gate. A file under `src/web/scene/<layer>/` imports only lower layers, its own
// layer and the scene root files, so the sim never reaches a renderer and nothing reaches the
// 3D renderer except the composer's lazy `import()`.
import { Glob } from 'bun'
import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

import { lineAt, scanImports } from './import-scan'

const SRC = resolve(import.meta.dir, '../src')
const WEB = `${SRC}/web`
const SCENE = `${WEB}/scene`
const UI = `${WEB}/ui`
const UI_KIT = `${UI}/kit`
const ALIAS_PREFIX = '@/'
const COMPOSER = 'canvas'
const THREE_PACKAGE = 'three'
const RENDER_3D = 'render3d'
const OVERLAY = 'overlay'
// A component's own stylesheet carries no code, so it crosses no layer.
const STYLESHEET_EXTENSION = '.css'
const SCENE_LAYERS: Readonly<Record<string, number>> = Object.freeze({
  world: 0,
  clock: 1,
  data: 2,
  sim: 3,
  render2d: 4,
  render3d: 4,
  sprites: 4,
  overlay: 5,
})
// Root files every layer may import; the composer is a root file no layer imports.
const ROOT_FILES: ReadonlySet<string> = new Set(['types', 'street-types', 'sky-types', 'overlay-types', 'renderer', 'budgets', 'view'])
// The composer and the sims it builds: root files no layer imports, free to reach every layer.
const COMPOSER_FILES: ReadonlySet<string> = new Set([COMPOSER, 'sims'])
// Same-rank reaches allowed by name: importer layer -> path prefixes under `scene/`.
const SIDE_REACHES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  render2d: ['sprites/'],
  render3d: ['sprites/', 'render2d/street/'],
})

interface Place {
  /** `root` for a file directly under `scene/`, else its layer folder. */
  readonly layer: string
  /** The path under `scene/`, without extension. */
  readonly path: string
}

const violations: string[] = []

for (const file of new Glob('**/*.{ts,tsx}').scanSync(WEB)) {
  const absolute = `${WEB}/${file}`
  const source = readFileSync(absolute, 'utf8')

  for (const found of scanImports(source)) {
    const message = issueOf(absolute, found.specifier, found.isDynamic)

    if (message !== undefined) {
      violations.push(`  ${relative(SRC, absolute)}:${lineAt(source, found.index)} - ${message}`)
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(`FAIL: ${violations.length} scene layer violation(s):\n${violations.join('\n')}\n`)
  process.exit(1)
}

process.stdout.write('check-scene-layers: PASS\n')

function issueOf(importer: string, specifier: string, isDynamic: boolean): string | undefined {
  if (specifier.endsWith(STYLESHEET_EXTENSION)) {
    return undefined
  }

  const target = resolveTarget(importer, specifier)
  const from = placeOf(importer)

  if (target === undefined) {
    const isThree = specifier === THREE_PACKAGE || specifier.startsWith(`${THREE_PACKAGE}/`)

    return isThree && from?.layer !== RENDER_3D ? `'${specifier}' is imported only under scene/${RENDER_3D}/` : undefined
  }

  const to = placeOf(target)

  if (to?.layer === RENDER_3D && from?.layer !== RENDER_3D) {
    const isComposerLoad = isDynamic && from?.path === COMPOSER

    return isComposerLoad ? undefined : `scene/${RENDER_3D}/ is reached only by import() from scene/${COMPOSER}.tsx`
  }

  if (from === undefined) {
    return undefined
  }

  if (target.startsWith(`${UI}/`)) {
    const isKit = from.layer === OVERLAY && target.startsWith(`${UI_KIT}/`)

    return isKit ? undefined : `scene/${from.layer}/ may not import '${specifier}' (only scene/${OVERLAY}/ reaches ui/kit/)`
  }

  return to === undefined ? undefined : layerIssue(from, to, specifier)
}

function layerIssue(from: Place, to: Place, specifier: string): string | undefined {
  const isComposer = from.layer === 'root' && COMPOSER_FILES.has(from.path)

  if (to.layer === 'root') {
    return ROOT_FILES.has(to.path) || isComposer
      ? undefined
      : `'${specifier}' is the composer; no scene file imports it`
  }

  if (from.layer === 'root') {
    return isComposer ? undefined : `scene root file may import only root files, not '${specifier}'`
  }

  const fromRank = SCENE_LAYERS[from.layer]
  const toRank = SCENE_LAYERS[to.layer]

  if (fromRank === undefined || toRank === undefined) {
    return `'${from.layer}/' or '${to.layer}/' is not a scene layer`
  }

  if (to.layer === from.layer || toRank < fromRank) {
    return undefined
  }

  const reaches = SIDE_REACHES[from.layer] ?? []

  return reaches.some((prefix) => `${to.path}/`.startsWith(prefix))
    ? undefined
    : `scene/${from.layer}/ may not import scene/${to.layer}/ ('${specifier}')`
}

function resolveTarget(importer: string, specifier: string): string | undefined {
  if (specifier.startsWith(ALIAS_PREFIX)) {
    return `${SRC}/${specifier.slice(ALIAS_PREFIX.length)}`
  }

  return specifier.startsWith('.') ? resolve(dirname(importer), specifier) : undefined
}

function placeOf(path: string): Place | undefined {
  if (!path.startsWith(`${SCENE}/`)) {
    return undefined
  }

  const under = path.slice(SCENE.length + 1).replace(/\.tsx?$/, '')
  const slash = under.indexOf('/')

  return slash === -1 ? { layer: 'root', path: under } : { layer: under.slice(0, slash), path: under }
}
