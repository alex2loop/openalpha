#!/usr/bin/env bun
// The one way to deploy a static site: `bun run deploy:web` or `bun run deploy:site`, with
// `--env production` for the real domain and no `--env` for staging. It runs wrangler only when the
// build stamp (`dist/<kind>.stamp.json`, written by the build) agrees with the target: production
// takes a crawlable build addressed to the production domain, staging a noindex build addressed
// elsewhere. The production domain is the route in `[env.production]` of the site's own
// `wrangler.toml`, so no address is written here. `--dry-run` is passed on to wrangler.
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { type BuildStamp, readStamp, type SiteKind } from './web-files'

const ROOT = resolve(import.meta.dir, '..')
const PRODUCTION_ENV = 'production'
const KINDS: readonly SiteKind[] = ['web', 'site']

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

if (values['dry-run'] === true) {
  args.push('--dry-run')
}

const wrangler = Bun.spawn([process.execPath, 'run', 'wrangler', ...args], {
  cwd: ROOT,
  stdio: ['inherit', 'inherit', 'inherit'],
})

process.exitCode = await wrangler.exited

async function refuseMismatch(site: SiteKind, toProduction: boolean): Promise<void> {
  const stamp = await readStamp(site)
  const target = toProduction ? PRODUCTION_ENV : 'staging'
  const problems: string[] = []

  if (stamp.noindex === toProduction) {
    problems.push(
      toProduction ? 'it is a noindex (staging) build' : 'it is a crawlable (production) build'
    )
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

// Each address a build stamped, with the production host its Worker is routed to. The homepage
// also links to the app, so its app address is held to the same side as its own.
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
  const config = Bun.TOML.parse(await Bun.file(configOf(site)).text()) as {
    env?: { production?: { routes?: { pattern?: unknown }[] } }
  }
  const pattern = config.env?.production?.routes?.[0]?.pattern

  if (typeof pattern !== 'string') {
    throw new Error(`deploy: ${configOf(site)} has no production route`)
  }

  return pattern
}

function configOf(site: SiteKind): string {
  return resolve(ROOT, 'deploy', site, 'wrangler.toml')
}
