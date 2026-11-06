// The page's content security policy requires Trusted Types for script sinks, so a plain string
// reaches none of them. The one string the page hands a sink is its service worker's address: this
// default policy lets exactly that through and refuses every other script URL, so nothing else can
// load code. A browser without Trusted Types has no factory and needs none.
const DEFAULT_POLICY_NAME = 'default'

/** Called once, before the page registers its service worker. */
export function allowScriptUrl(allowedUrl: string): void {
  window.trustedTypes?.createPolicy(DEFAULT_POLICY_NAME, {
    createScriptURL: (url) => (url === allowedUrl ? url : null),
  })
}
