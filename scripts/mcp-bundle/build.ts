#!/usr/bin/env bun
// One launcher that starts the installed binary with `mcp serve`, shipped two ways: the MCP bundle
// (manifest in the default locale plus one override file per other locale, validated and packed by
// the mcpb CLI) and the npm package. server.json lists both for the registry.
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import type { Locale } from '@/core/types/locale'
import type { LauncherConfig } from './launcher-config'
import { BRAND } from '@/core/brand'
import { LOCALES } from '@/core/types/locale'
import { t } from '@/i18n'
import pkg from '../../package.json' with { type: 'json' }
import { PATH_PLACEHOLDER, REASON_PLACEHOLDER } from './launcher-config'

const ROOT = resolve(import.meta.dir, '../..')
const OUT_DIR = resolve(ROOT, 'dist')
const STAGE_DIR = resolve(OUT_DIR, 'mcp-bundle')
const NPM_DIR = resolve(OUT_DIR, 'npm')
const BUNDLE_PATH = resolve(OUT_DIR, `${BRAND.name}.mcpb`)
const SERVER_JSON_PATH = resolve(OUT_DIR, 'server.json')
const LAUNCHER_SOURCE = resolve(import.meta.dir, 'launch.ts')
const MCPB_BIN = resolve(ROOT, 'node_modules/.bin/mcpb')
const LAUNCHER_FILE = 'launch.cjs'
const MCPB_LAUNCHER_PATH = `server/${LAUNCHER_FILE}`
const MANIFEST_FILE = 'manifest.json'
const RESOURCES_DIR = 'mcpb-resources'
const NPM_MANIFEST_FILE = 'package.json'
const NPM_README_FILE = 'README.md'
const NPM_NAME = `${BRAND.name}-mcp`
const NPM_RUNTIME_HINT = 'npx'
const NODE_ENGINE = '>=18'
const NODE_SHEBANG = '#!/usr/bin/env node'
const MANIFEST_VERSION = '0.3'
const DEFAULT_LOCALE: Locale = 'en'
const LOCALE_TAGS = { en: 'en-US', vi: 'vi-VN' } as const satisfies Record<Locale, string>
// The variable and default folder install.sh and install.ps1 use, so one setting serves both.
const INSTALL_DIR_ENV = `${BRAND.envPrefix}INSTALL_DIR`
const DEFAULT_INSTALL_DIR = '.local/bin'
const INSTALL_URL = `${BRAND.repository}#readme`
const SERVER_SCHEMA_URL =
  'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json'
const REGISTRY_DESCRIPTION_MAX = 100
const GITHUB_REPOSITORY_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/
// MCPB variables, filled in by the host app at install and launch; not template literals.
const MCPB_DIRNAME = '${__dirname}'
const MCPB_HOME = '${HOME}'
const MCPB_INSTALL_DIR_SETTING = '${user_config.install_dir}'
const MCPB_LOCALE = '${locale}'

interface LocalizedText {
  readonly description: string
  readonly long_description: string
}

await main()

async function main(): Promise<void> {
  const { description } = buildLocalizedText(DEFAULT_LOCALE)
  const registryName = toRegistryName(BRAND.repository)

  assertRegistryDescription(description)

  const launcher = await buildLauncher()

  await writeNpmPackage(launcher, registryName)
  await writeMcpBundle(launcher)
  await writeJson(
    SERVER_JSON_PATH,
    buildServerJson({ description, registryName, bundleSha256: await sha256Of(BUNDLE_PATH) })
  )
}

function toRegistryName(repositoryUrl: string): string {
  const match = GITHUB_REPOSITORY_RE.exec(repositoryUrl)

  if (match === null) {
    throw new Error(`build-mcp-bundle: ${repositoryUrl} is not a GitHub repository URL`)
  }

  return `io.github.${match[1]}/${match[2]}`
}

function assertRegistryDescription(description: string): void {
  if (description.length > REGISTRY_DESCRIPTION_MAX) {
    throw new Error(
      `build-mcp-bundle: mcpBundle.description is ${description.length} characters; the registry takes at most ${REGISTRY_DESCRIPTION_MAX}`
    )
  }
}

// CommonJS in a `.cjs` file: the host's Node loads it as a script wherever it is unpacked.
async function buildLauncher(): Promise<string> {
  const config: LauncherConfig = {
    binaryName: BRAND.name,
    installDirEnv: INSTALL_DIR_ENV,
    defaultInstallDir: DEFAULT_INSTALL_DIR,
    missingMessageLines: LOCALES.map((locale) =>
      t(locale, 'mcpBundle.binaryMissing', {
        brand: BRAND.display,
        path: PATH_PLACEHOLDER,
        installUrl: INSTALL_URL,
        env: INSTALL_DIR_ENV,
      })
    ),
    unstartableMessageLines: LOCALES.map((locale) =>
      t(locale, 'mcpBundle.binaryUnstartable', {
        brand: BRAND.display,
        path: PATH_PLACEHOLDER,
        reason: REASON_PLACEHOLDER,
      })
    ),
  }
  const result = await Bun.build({
    entrypoints: [LAUNCHER_SOURCE],
    target: 'node',
    format: 'cjs',
    minify: true,
    banner: NODE_SHEBANG,
    define: { LAUNCHER_CONFIG: JSON.stringify(config) },
  })
  const [output] = result.outputs

  if (!result.success || output === undefined) {
    throw new Error(`build-mcp-bundle: the launcher did not build: ${result.logs.join('\n')}`)
  }

  return await output.text()
}

async function writeNpmPackage(launcher: string, registryName: string): Promise<void> {
  await rm(NPM_DIR, { recursive: true, force: true })
  await writeFileIn(join(NPM_DIR, LAUNCHER_FILE), launcher)
  await writeJson(join(NPM_DIR, NPM_MANIFEST_FILE), buildNpmManifest(registryName))
  await writeFileIn(join(NPM_DIR, NPM_README_FILE), buildNpmReadme())
}

// The registry proves the package is this server's by its `mcpName`.
function buildNpmManifest(registryName: string): Record<string, unknown> {
  return {
    name: NPM_NAME,
    version: BRAND.version,
    description: buildLocalizedText(DEFAULT_LOCALE).description,
    license: pkg.license,
    repository: { type: 'git', url: `git+${BRAND.repository}.git` },
    homepage: BRAND.repository,
    bin: { [NPM_NAME]: LAUNCHER_FILE },
    files: [LAUNCHER_FILE, NPM_README_FILE],
    engines: { node: NODE_ENGINE },
    mcpName: registryName,
  }
}

// npm shows one page to every reader, so it takes the default locale; the repository README it
// links to carries the other languages.
function buildNpmReadme(): string {
  const text = buildLocalizedText(DEFAULT_LOCALE)

  return `# ${BRAND.display}\n\n${text.description}\n\n${text.long_description}\n`
}

async function writeMcpBundle(launcher: string): Promise<void> {
  await rm(STAGE_DIR, { recursive: true, force: true })

  try {
    await writeFileIn(join(STAGE_DIR, MCPB_LAUNCHER_PATH), launcher)
    await writeJson(join(STAGE_DIR, MANIFEST_FILE), buildManifest())

    for (const locale of LOCALES) {
      if (locale !== DEFAULT_LOCALE) {
        await writeJson(
          join(STAGE_DIR, RESOURCES_DIR, `${LOCALE_TAGS[locale]}.json`),
          buildLocalizedText(locale)
        )
      }
    }

    await runMcpb(['validate', join(STAGE_DIR, MANIFEST_FILE)])
    await runMcpb(['pack', STAGE_DIR, BUNDLE_PATH])
  } finally {
    await rm(STAGE_DIR, { recursive: true, force: true })
  }
}

function buildManifest(): Record<string, unknown> {
  return {
    manifest_version: MANIFEST_VERSION,
    name: BRAND.name,
    display_name: BRAND.display,
    version: BRAND.version,
    ...buildLocalizedText(DEFAULT_LOCALE),
    author: { name: BRAND.display, url: BRAND.repository },
    repository: { type: 'git', url: BRAND.repository },
    homepage: BRAND.repository,
    license: pkg.license,
    server: {
      type: 'node',
      entry_point: MCPB_LAUNCHER_PATH,
      mcp_config: {
        command: 'node',
        args: [`${MCPB_DIRNAME}/${MCPB_LAUNCHER_PATH}`],
        env: { [INSTALL_DIR_ENV]: MCPB_INSTALL_DIR_SETTING },
      },
    },
    user_config: {
      install_dir: {
        type: 'directory',
        title: t(DEFAULT_LOCALE, 'mcpBundle.installDirTitle', { brand: BRAND.display }),
        description: buildInstallDirDescription(),
        required: true,
        default: `${MCPB_HOME}/${DEFAULT_INSTALL_DIR}`,
      },
    },
    tools_generated: true,
    localization: {
      resources: `${RESOURCES_DIR}/${MCPB_LOCALE}.json`,
      default_locale: LOCALE_TAGS[DEFAULT_LOCALE],
    },
  }
}

function buildLocalizedText(locale: Locale): LocalizedText {
  return {
    description: t(locale, 'mcpBundle.description'),
    long_description: t(locale, 'mcpBundle.longDescription', {
      brand: BRAND.display,
      installUrl: INSTALL_URL,
    }),
  }
}

function buildServerJson(input: {
  readonly description: string
  readonly registryName: string
  readonly bundleSha256: string
}): Record<string, unknown> {
  return {
    $schema: SERVER_SCHEMA_URL,
    name: input.registryName,
    title: BRAND.display,
    description: input.description,
    version: BRAND.version,
    repository: { url: BRAND.repository, source: 'github' },
    packages: [
      {
        registryType: 'mcpb',
        identifier: `${BRAND.repository}/releases/download/v${BRAND.version}/${BRAND.name}.mcpb`,
        fileSha256: input.bundleSha256,
        transport: { type: 'stdio' },
      },
      {
        registryType: 'npm',
        identifier: NPM_NAME,
        version: BRAND.version,
        runtimeHint: NPM_RUNTIME_HINT,
        transport: { type: 'stdio' },
        environmentVariables: [
          {
            name: INSTALL_DIR_ENV,
            description: buildInstallDirDescription(),
            isRequired: false,
            isSecret: false,
          },
        ],
      },
    ],
  }
}

function buildInstallDirDescription(): string {
  return t(DEFAULT_LOCALE, 'mcpBundle.installDirDescription', { brand: BRAND.display })
}

async function runMcpb(args: readonly string[]): Promise<void> {
  const child = Bun.spawn([MCPB_BIN, ...args], { stdout: 'inherit', stderr: 'inherit' })
  const code = await child.exited

  if (code !== 0) {
    throw new Error(`build-mcp-bundle: mcpb ${args[0]} exited with ${code}`)
  }
}

async function sha256Of(path: string): Promise<string> {
  const bytes = await Bun.file(path).arrayBuffer()

  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFileIn(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeFileIn(path: string, body: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, body, 'utf8')
}
