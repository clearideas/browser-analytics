// Script-tag build (dist/analytics.js): no build tools needed.
//
//   <script async src="…/analytics.js"
//           data-api-base-url="https://collector.example.com/"
//           data-site-key="my-site"></script>
//
// More settings (integrations, banner texts, …) can be given as a global set before the
// script: window.ciAnalyticsConfig = { … }. Calls made before the script has loaded can
// be queued: (window.ciAnalyticsQueue = window.ciAnalyticsQueue || []).push(['trackEvent', 'sign_up', {…}]).
// The API is available as window.ClearIdeasAnalytics.
import type { BrowserAnalytics, BrowserAnalyticsOptions } from './browser'
import { getBrowserAnalytics, initBrowserAnalytics } from './browser'
import type { AnalyticsOptions } from './core'
import type { AnalyticsConfig } from './types'

type Command = [string, ...unknown[]]

declare global {
  interface Window {
    ciAnalyticsConfig?: Partial<AnalyticsConfig> & BrowserAnalyticsOptions
    ciAnalyticsQueue?: Command[] | { push: (command: Command) => void }
    ClearIdeasAnalytics?: typeof api
  }
}

/** Settings from the script tag's data-* attributes. */
export function readScriptConfig(
  script: HTMLOrSVGScriptElement | null,
): Partial<AnalyticsOptions> & BrowserAnalyticsOptions {
  const data = (script as HTMLScriptElement | null)?.dataset ?? {}
  const config: Partial<AnalyticsOptions> & BrowserAnalyticsOptions = {}
  if (data.apiBaseUrl) config.apiBaseUrl = data.apiBaseUrl
  if (data.siteKey) config.siteKey = data.siteKey
  if (data.cookieDomain) config.cookieDomain = data.cookieDomain
  if (data.websiteBaseUrl) config.websiteBaseUrl = data.websiteBaseUrl
  if (data.debug === 'true') config.debug = true
  if (data.banner === 'false') config.banner = false
  if (data.routeChanges === 'manual') config.routeChanges = 'manual'
  return config
}

/** Run a queued command such as ['trackEvent', 'sign_up', {…}] or ['consent.accept']. */
export function runCommand(analytics: BrowserAnalytics, [name, ...args]: Command): void {
  const [scope, method] = name.startsWith('consent.')
    ? [analytics.consent, name.slice(8)]
    : [analytics, name]
  const fn = (scope as unknown as Record<string, unknown>)[method]
  if (typeof fn === 'function') fn.apply(scope, args)
  else console.warn(`[Analytics] Unknown command "${name}"`)
}

/** Start from the script tag and window.ciAnalyticsConfig (data-* attributes win). */
export function autoInit(script: HTMLOrSVGScriptElement | null): BrowserAnalytics | null {
  if ((script as HTMLScriptElement | null)?.dataset?.autoInit === 'false') return null
  const { routeChanges, ...settings } = { ...window.ciAnalyticsConfig, ...readScriptConfig(script) }
  if (!settings.apiBaseUrl || !settings.siteKey) {
    console.warn('[Analytics] Set data-api-base-url and data-site-key on the script tag')
    return null
  }
  const analytics = initBrowserAnalytics(settings as AnalyticsOptions, { routeChanges })

  // Run queued commands once the consent policy is known, in order; later pushes too.
  const queued = Array.isArray(window.ciAnalyticsQueue) ? window.ciAnalyticsQueue : []
  let chain = analytics.ready()
  const enqueue = (command: Command) => {
    chain = chain.then(() => runCommand(analytics, command))
  }
  window.ciAnalyticsQueue = { push: enqueue }
  for (const command of queued) enqueue(command)
  return analytics
}

const api = {
  /** Start manually (with data-auto-init="false"). */
  init: (options: AnalyticsOptions, browserOptions?: BrowserAnalyticsOptions) =>
    initBrowserAnalytics(options, browserOptions),
  /** The running instance (trackEvent, consent, …), or null. */
  get: getBrowserAnalytics,
}

export function installGlobal(): void {
  window.ClearIdeasAnalytics = api
}
