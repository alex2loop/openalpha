import pkg from '../../package.json' with { type: 'json' }

interface Brand {
  readonly name: string
  readonly display: string
  readonly dataDirName: string
  readonly envPrefix: string
  readonly pidFile: string
  readonly stopFile: string
  readonly readyFile: string
  readonly version: string
  readonly repository: string
  readonly sampleConfigUrl: string
  readonly pluginGuideUrl: string
  readonly packageName: string
}

const GIT_URL_PREFIX_RE = /^git\+/
const GIT_URL_SUFFIX_RE = /\.git$/
const SAMPLE_CONFIG_PATH = 'blob/main/config.sample.toml'
const PLUGIN_GUIDE_PATH = 'blob/main/docs/en/dev/extending.md'

// The product name, not the package name: `@openalpha/runtime` is a workspace path, and deriving
// from it would brand the whole product "runtime". Falls back to the unscoped package name.
const display =
  'productName' in pkg && typeof pkg.productName === 'string'
    ? pkg.productName
    : pkg.name.replace(/^@[^/]+\//, '')

const name = display.toLowerCase()
const version = 'version' in pkg && typeof pkg.version === 'string' ? pkg.version : '0.0.0'
const repository = pkg.repository.url.replace(GIT_URL_PREFIX_RE, '').replace(GIT_URL_SUFFIX_RE, '')

export const BRAND: Brand = Object.freeze({
  name,
  display,
  dataDirName: `.${name}`,
  envPrefix: `${name.toUpperCase().replace(/-/g, '_')}_`,
  pidFile: `${name}.pid`,
  stopFile: `${name}.stop`,
  readyFile: `${name}.ready`,
  version,
  repository,
  sampleConfigUrl: `${repository}/${SAMPLE_CONFIG_PATH}`,
  pluginGuideUrl: `${repository}/${PLUGIN_GUIDE_PATH}`,
  packageName: pkg.name,
})
