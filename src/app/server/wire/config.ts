// The /v1 config routes: the raw config, the provider catalog, the key test and `setup`.

/** GET /v1/config — the raw config.toml as JSON, every literal secret shown as `redacted`; a write
 *  that sends `redacted` back keeps the file's value. */
export interface ConfigResponse {
  readonly config: unknown
  readonly configPath: string
  readonly redacted: string
}

interface ConfigIssue {
  readonly path: string
  readonly message: string
  /** A field a write may not carry (a hidden secret, a CLI-only change); its message names it. */
  readonly refused?: true
}

/** POST /v1/config/validate result (also the pre-write gate for POST /v1/config). */
export interface ConfigValidation {
  readonly ok: boolean
  readonly issues?: readonly ConfigIssue[]
}

/** POST /v1/config result. `restartRequired` is always true — config is merged once at boot. */
export interface ConfigWriteResult {
  readonly ok: boolean
  readonly restartRequired: boolean
}

/** GET /v1/providers — one inline-catalog provider for the model picker. `envVar`/`auth` carry the
 *  catalog's `apiKeyEnv`/`authStyle`. */
interface ProviderCatalogEntry {
  readonly id: string
  readonly displayName: string
  readonly envVar: string
  readonly baseUrl: string
  readonly transport: string
  readonly auth: string
  readonly defaultModel?: string
}

interface CatalogModelEntry {
  readonly name: string
  readonly provider: string
  readonly model: string
}

export interface ProviderCatalogResponse {
  readonly providers: readonly ProviderCatalogEntry[]
  readonly catalogModels: readonly CatalogModelEntry[]
}

/** `setup` output, one JSON line: a client app's first run before any daemon runs.
 *  `catalog` answers the provider list; `write` answers where the config went and which
 *  environment variable carries the key. */
export type SetupResult =
  | { readonly ok: true; readonly catalog: ProviderCatalogResponse }
  | { readonly ok: true; readonly configPath: string; readonly keyEnv: string }
  | {
      readonly ok: false
      readonly code: 'usage' | 'unknown_provider' | 'config_exists' | 'invalid'
      readonly configPath?: string
    }

/** POST /v1/providers/test — one tiny call through the primary model. `code` is the provider's
 *  error class when the call fails (`auth` = key refused, `billing` = no credit). */
export type ProviderTestResult =
  | { readonly ok: true; readonly model: string }
  | { readonly ok: false; readonly code: string }
