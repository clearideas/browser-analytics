// Plugin contract. Integrations (Google Analytics, Microsoft UET, OpenAI Ads, Clear Ideas
// Chat, or your own) are plugins. The core decides when a plugin may load and which
// events it receives; plugins never check consent themselves.
import type { CategoryState, ConsentCategory } from '../categories'
import { OPTIONAL_CATEGORIES } from '../categories'
import type { AnalyticsConfig, AttributionData } from '../types'

/** Consent situation of the current visitor. */
export interface ConsentState {
  /** The collector requires opt-in consent for this visitor. */
  required: boolean
  /**
   * Overall decision for the current policy version: true when everything was accepted,
   * false when decided otherwise (rejected or a partial choice), null when undecided.
   */
  granted: boolean | null
  /** Choice per category (null: undecided). */
  categories: CategoryState
  /** The browser sends a Global Privacy Control signal and the site honors it. */
  gpc: boolean
}

/** ConsentState plus what this plugin may do. */
export interface PluginConsentState extends ConsentState {
  /** The plugin's own category is allowed (it may run). */
  allowed: boolean
  /**
   * Which categories are allowed right now (explicit choice, else allowed where consent is
   * not required, except marketing under Global Privacy Control). For plugins that cover
   * several purposes, e.g. analytics_storage vs ad_storage in Google Consent Mode.
   */
  allowedCategories: Record<ConsentCategory, boolean>
}

/**
 * A name the vendor uses for a cookie or storage key: exact, prefix ending in "*", or
 * RegExp; optionally tied to one category (default: the plugin's own category).
 */
export type NameRule = string | RegExp | { name: string | RegExp; category: ConsentCategory }

/** A first-party cookie the vendor sets. */
export type CookieRule = NameRule

/** A localStorage/sessionStorage key the vendor sets. */
export type StorageRule = NameRule

/**
 * What happens when consent for a running plugin is withdrawn.
 * 'stop': the plugin's consentChanged() stops the vendor (e.g. Consent Mode "denied").
 * 'reload': the vendor cannot be stopped once running; the page is reloaded after the
 * decision is saved, so the vendor code is gone (see consent.reloadOnWithdrawal).
 */
export type WithdrawalMode = 'stop' | 'reload'

/** An event as delivered to plugins. */
export interface PluginEvent {
  /** Event name as tracked by the site (not normalized). */
  name: string
  /**
   * Parameters safe to forward to a third party: the event's own properties (URLs
   * sanitized) without attribution, click IDs or this library's control keys.
   */
  params: Record<string, any>
  /** All of the event's own properties, including control keys such as ads_send_to. */
  props: Record<string, any>
  /** First-touch attribution, for conversion decisions. Never forward it as-is. */
  attribution?: AttributionData
}

export interface PluginContext {
  readonly config: AnalyticsConfig
  consent(): PluginConsentState
  debug(message: string, data?: unknown): void
  /** Load a script once (deduplicated by URL). Rejects if it fails to load. */
  loadScript(src: string, options?: ResourceOptions): Promise<void>
  /** Load a stylesheet once (deduplicated by URL). */
  loadStylesheet(href: string, options?: ResourceOptions): Promise<void>
}

export interface ResourceOptions {
  /** Subresource Integrity hash, e.g. "sha384-..." (sets crossorigin="anonymous"). */
  integrity?: string
}

export interface AnalyticsPlugin {
  /** Unique name, e.g. "googleAnalytics". */
  name: string
  /**
   * The consent category the plugin needs in order to run (default 'marketing').
   * 'necessary' runs without consent.
   */
  category?: ConsentCategory
  /** @deprecated Use category. false means 'necessary'. */
  requiresConsent?: boolean
  /**
   * First-party cookies the vendor sets. Deleted when their category is withdrawn or
   * refused (on every page load while it stays refused).
   */
  cookies?: CookieRule[]
  /** localStorage/sessionStorage keys the vendor sets; removed like cookies. */
  storage?: StorageRule[]
  /**
   * How withdrawal stops the vendor. Default: 'stop' if the plugin has consentChanged(),
   * else 'reload'.
   */
  withdrawal?: WithdrawalMode
  /**
   * Load the plugin (and announce the consent state) even before it is allowed, for
   * bridges to a vendor tag the page installs itself. Events are still only delivered
   * while allowed, and load() must not load vendor code.
   */
  loadWithoutConsent?: boolean
  /** Called once, the first time the plugin is allowed to run. */
  load?(ctx: PluginContext): void | Promise<void>
  /** Called after load whenever the consent state changes. */
  consentChanged?(state: PluginConsentState, ctx: PluginContext): void
  /** Called for each tracked event while the plugin is allowed and loaded. */
  track?(event: PluginEvent, ctx: PluginContext): void
}

/**
 * A plugin known before its code is loaded. Built-in integrations are declared this way
 * so their code is downloaded only when configured and allowed.
 */
export interface PluginSpec {
  name: string
  category: ConsentCategory
  /**
   * Load the plugin (and announce the consent state to it) even before it is allowed.
   * For bridges to vendor tags the page installs itself: the tag is already present, so
   * the bridge keeps its consent state in sync (e.g. "denied"). Events are still only
   * delivered while allowed, and such a plugin must not load vendor code in load().
   */
  loadWithoutConsent?: boolean
  cookies?: CookieRule[]
  storage?: StorageRule[]
  /** Default 'stop'. */
  withdrawal?: WithdrawalMode
  create(): AnalyticsPlugin | Promise<AnalyticsPlugin>
}

/** The category a plugin needs (requiresConsent: false means 'necessary'). */
export function pluginCategory(
  plugin: Pick<AnalyticsPlugin, 'category' | 'requiresConsent'>,
): ConsentCategory {
  if (plugin.category) return plugin.category
  return plugin.requiresConsent === false ? 'necessary' : 'marketing'
}

/** Whether a category is allowed in the given consent state. */
export function isCategoryAllowed(category: ConsentCategory, state: ConsentState): boolean {
  if (category === 'necessary') return true
  const choice = state.categories[category]
  if (choice === true || choice === false) return choice
  // Undecided: allowed only where consent is not required. Global Privacy Control is an
  // opt-out of sale/sharing, so it withholds marketing.
  return !state.required && !(state.gpc && category === 'marketing')
}

/**
 * Categories whose data must be removed after a consent change: allowed before and not
 * any more (withdrawn), or explicitly refused now and not before (on the first state of a
 * page, a stored refusal counts, so refused data is removed on every page load).
 */
export function removedCategories(
  previous: ConsentState | null,
  next: ConsentState,
): ConsentCategory[] {
  const before = previous ? allowedCategories(previous) : null
  const now = allowedCategories(next)
  return OPTIONAL_CATEGORIES.filter(
    category =>
      !now[category] &&
      (before?.[category] === true ||
        (next.categories[category] === false && previous?.categories[category] !== false)),
  )
}

export function allowedCategories(state: ConsentState): Record<ConsentCategory, boolean> {
  return {
    necessary: true,
    preferences: isCategoryAllowed('preferences', state),
    statistics: isCategoryAllowed('statistics', state),
    marketing: isCategoryAllowed('marketing', state),
  }
}

/** Whether a plugin may run in the given consent state. */
export function isPluginAllowed(
  plugin: Pick<AnalyticsPlugin, 'category' | 'requiresConsent'>,
  state: ConsentState,
): boolean {
  return isCategoryAllowed(pluginCategory(plugin), state)
}
