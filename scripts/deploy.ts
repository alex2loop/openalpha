#!/usr/bin/env bun
// The one way to deploy a site: `bun run deploy:web`, `deploy:site` or `deploy:brief`, with
// `--env production` for the real domain and no `--env` for staging. It runs wrangler only when the
// build stamp (`dist/<kind>.stamp.json`, written by the build) agrees with the target: production
// takes a crawlable build addressed to the production domain, staging a noindex build addressed
// elsewhere. The phone brief is the one exception: while `BRIEF_INVITE_ONLY` holds, production takes
// a noindex build and refuses a crawlable one. The production domain is the route in
// `[env.production]` of the site's own `wrangler.toml`, so no address is written here. The brief has
// a database: its migrations are applied to the target before the deploy. `--dry-run` is passed on
// to wrangler and applies nothing.
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { BRIEF_INVITE_ONLY } from './brief-invite'
import { type BuildStamp, readStamp, type SiteKind } from './web-files'

const ROOT = resolve(import.meta.dir, '..')
const PRODUCTION_ENV = 'production'
const KINDS: readonly SiteKind[] = ['web', 'site', 'brief']

interface Database {
  readonly database_name?: unknown
}

interface WranglerConfig {
  readonly d1_databases?: readonly Database[]
  readonly env?: {
    readonly production?: {
      readonly routes?: readonly { readonly pattern?: unknown }[]
      readonly d1_databases?: readonly Database[]
    }
  }
}

interface Address {
  readonly label: string
  readonly host: string
  readonly productionHost: string
}

const { values, positionals } = parseArgs({
  options: { env: { type: 'string' }, 'dry-run': { type: 'boolean' } },
  allowPositionals: true,
})
const kind = KINDS.find((candidate) => candidate === positionals[0])

if (kind === undefined || positionals.length !== 1) {
  throw new Error(`deploy: pass one of ${KINDS.join(' | ')} [--env production] [--dry-run]`)
}

if (values.env !== undefined && values.env !== PRODUCTION_ENV) {
  throw new Error(`deploy: --env is "${PRODUCTION_ENV}" or absent (staging), not "${values.env}"`)
}

const production = values.env === PRODUCTION_ENV

await refuseMismatch(kind, production)

// An empty `--env` names wrangler's top level, which is staging.
const args = ['deploy', '-c', configOf(kind), '--env', production ? PRODUCTION_ENV : '']
const dryRun = values['dry-run'] === true

if (dryRun) {
  args.push('--dry-run')
}

const migrationExit = kind === 'brief' && !dryRun ? await applyMigrations(kind, production) : 0

process.exitCode = migrationExit === 0 ? await runWrangler(args) : migrationExit

async function runWrangler(wranglerArgs: readonly string[]): Promise<number> {
  const wrangler = Bun.spawn([process.execPath, 'run', 'wrangler', ...wranglerArgs], {
    cwd: ROOT,
    stdio: ['inherit', 'inherit', 'inherit'],
  })

  return await wrangler.exited
}

// The target's schema first: a new Worker never meets a database older than its code.
async function applyMigrations(site: SiteKind, toProduction: boolean): Promise<number> {
  return await runWrangler([
    'd1',
    'migrations',
    'apply',
    await databaseNameOf(site, toProduction),
    '--remote',
    '-c',
    configOf(site),
    '--env',
    toProduction ? PRODUCTION_ENV : '',
  ])
}

async function refuseMismatch(site: SiteKind, toProduction: boolean): Promise<void> {
  const stamp = await readStamp(site)
  const target = toProduction ? PRODUCTION_ENV : 'staging'
  const problems: string[] = []
  const wantsNoindex = !toProduction || (site === 'brief' && BRIEF_INVITE_ONLY)

  if (stamp.noindex !== wantsNoindex) {
    problems.push(noindexProblem(site, toProduction, stamp.noindex))
  }

  for (const address of await addressesOf(site, stamp)) {
    if ((address.host === address.productionHost) !== toProduction) {
      const verb = toProduction ? 'is not' : 'is'

      problems.push(`${address.label} ${address.host} ${verb} the production host`)
    }
  }

  if (problems.length > 0) {
    throw new Error(`deploy: refusing to deploy ${site} to ${target}: ${problems.join('; ')}`)
  }
}

function noindexProblem(site: SiteKind, toProduction: boolean, noindex: boolean): string {
  if (noindex) {
    return 'it is a noindex build'
  }

  return toProduction && site === 'brief' && BRIEF_INVITE_ONLY
    ? 'it is a crawlable build, and the app is invite only (BRIEF_INVITE_ONLY)'
    : 'it is a crawlable build'
}

// Each address a build stamped, with the production host its Worker is routed to. The homepage and
// the phone app also link to the web app, so its app address is held to the same side as their own.
async function addressesOf(
  site: SiteKind,
  stamp: BuildStamp
): Promise<readonly Address[]> {
  const own = {
    label: `${site} address`,
    host: new URL(stamp.url).host,
    productionHost: await productionHostOf(site),
  }

  if (site === 'web') {
    return [own]
  }

  return [
    own,
    {
      label: 'app address',
      host: new URL(stamp.appUrl).host,
      productionHost: await productionHostOf('web'),
    },
  ]
}

async function productionHostOf(site: SiteKind): Promise<string> {
  const pattern = (await readConfig(site)).env?.production?.routes?.[0]?.pattern

  if (typeof pattern !== 'string') {
    throw new Error(`deploy: ${configOf(site)} has no production route`)
  }

  return pattern
}

async function databaseNameOf(site: SiteKind, toProduction: boolean): Promise<string> {
  const config = await readConfig(site)
  const databases = toProduction ? config.env?.production?.d1_databases : config.d1_databases
  const name = databases?.[0]?.database_name

  if (typeof name !== 'string') {
    const target = toProduction ? PRODUCTION_ENV : 'staging'

    throw new Error(`deploy: ${configOf(site)} has no database for ${target}`)
  }

  return name
}

// Only the keys deploy reads, each checked by its caller before use.
async function readConfig(site: SiteKind): Promise<WranglerConfig> {
  return Bun.TOML.parse(await Bun.file(configOf(site)).text()) as WranglerConfig
}

function configOf(site: SiteKind): string {
  return resolve(ROOT, 'deploy', site, 'wrangler.toml')
}
