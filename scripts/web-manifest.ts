// What makes a page installable on a phone: the app manifest, the icons it names and the head tags
// that point a phone at them. The icons are committed PNGs rendered from `assets/brand/logo.svg`
// (rounded for the manifest's `any` sizes, full-bleed for the maskable one and the iOS touch icon,
// which the system rounds itself), so the build stays deterministic and needs no rasteriser. The
// tags are stamped after the page is bundled, because the bundler would try to resolve their
// addresses as source files.
import { cp } from 'node:fs/promises'
import { resolve } from 'node:path'

import { BRAND } from '@/core/brand'
import {
  APP_ROOT,
  CANVAS_DARK,
  CANVAS_LIGHT,
  TAB_ICON_FILE,
} from '@/web/brief/install-look'

import { insertInHead } from './browser-build'

const ROOT = resolve(import.meta.dir, '..')
const ICON_DIR = resolve(ROOT, 'assets/brand/pwa')
const MANIFEST_FILE = 'manifest.webmanifest'
const TOUCH_ICON_FILE = 'apple-touch-icon.png'
const DISPLAY_MODE = 'standalone'
const ICONS = [
  { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
] as const

export interface ManifestOptions {
  /** The install identity: two apps with one id are one app. */
  readonly id: string
  readonly startUrl: string
  readonly scope: string
  readonly name: string
}

export interface WebManifest {
  readonly name: string
  readonly short_name: string
  readonly id: string
  readonly start_url: string
  readonly scope: string
  readonly display: typeof DISPLAY_MODE
  readonly theme_color: string
  readonly background_color: string
  readonly icons: typeof ICONS
}

/** Writes the manifest and copies every icon beside the page. */
export async function writeInstallFiles(outDir: string, options: ManifestOptions): Promise<void> {
  await cp(ICON_DIR, outDir, { recursive: true })
  await Bun.write(
    resolve(outDir, MANIFEST_FILE),
    `${JSON.stringify(buildManifest(options), null, 2)}\n`
  )
}

/** Adds the manifest link, the tab icon, the theme colours and the iOS Home Screen tags before the
 *  page's `</head>`. The standalone status bar keeps the system's default style. */
export function stampInstallTags(html: string): string {
  return insertInHead(html, [
    `<link rel="manifest" href="${APP_ROOT}${MANIFEST_FILE}" />`,
    `<link rel="icon" type="image/png" href="${APP_ROOT}${TAB_ICON_FILE}" />`,
    `<meta name="theme-color" content="${CANVAS_LIGHT}" media="(prefers-color-scheme: light)" />`,
    `<meta name="theme-color" content="${CANVAS_DARK}" media="(prefers-color-scheme: dark)" />`,
    `<link rel="apple-touch-icon" href="${APP_ROOT}${TOUCH_ICON_FILE}" />`,
    '<meta name="mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-capable" content="yes" />',
    `<meta name="apple-mobile-web-app-title" content="${BRAND.display}" />`,
    '<meta name="apple-mobile-web-app-status-bar-style" content="default" />',
  ])
}

export function buildManifest(options: ManifestOptions): WebManifest {
  return {
    name: options.name,
    short_name: options.name,
    id: options.id,
    start_url: options.startUrl,
    scope: options.scope,
    display: DISPLAY_MODE,
    theme_color: CANVAS_LIGHT,
    background_color: CANVAS_LIGHT,
    icons: ICONS,
  }
}
