// HubSpot tracking code (js.hs-scripts.com/<portal>.js): page views, forms, chat and ads,
// all loaded by one script. Vendor API: _hsq (tracking) and _hsp (privacy).
import type { ConsentCategory } from '../categories'
import type { AnalyticsPlugin, PluginConsentState, PluginEvent } from './types'
import { pathOf, vendorId } from './util'
import { HUBSPOT_COOKIES } from './vendor-cookies'

export interface HubSpotOptions {
  /** HubSpot account (Hub) ID: the number in your tracking code URL. */
  portalId: string | number
  /** Data center of the account: 'na1' (default) or 'eu1'. */
  region?: 'na1' | 'eu1'
  /**
   * Consent category (default 'marketing'). The one script covers analytics, forms, chat
   * and advertising, and ties visits to CRM contacts.
   */
  category?: ConsentCategory
  /**
   * Report single-page navigations with setPath/trackPageView (default true). HubSpot
   * counts the page the script loads on by itself.
   */
  pageViews?: boolean
  /**
   * Site event -> HubSpot custom behavioral event (internal name, e.g. "pe1234567_signup"),
   * sent with trackCustomBehavioralEvent. Events not listed are not sent.
   */
  events?: Record<string, string>
  /** Override the tracking code URL. */
  scriptUrl?: string
}

declare global {
  interface Window {
    _hsq?: unknown[]
    _hsp?: unknown[]
    disableHubSpotCookieBanner?: boolean
  }
}

export function hubspot(options: HubSpotOptions): AnalyticsPlugin {
  let firstPageView = true
  let optedOut = false

  const hsq = (...command: unknown[]) => window._hsq?.push(command)
  const hsp = (...command: unknown[]) => window._hsp?.push(command)

  // HubSpot's consent categories, from ours.
  const applyConsent = (state: PluginConsentState) => {
    hsp('setHubSpotConsent', {
      analytics: state.allowed && state.allowedCategories.statistics,
      advertisement: state.allowed && state.allowedCategories.marketing,
      functionality: state.allowed && state.allowedCategories.preferences,
    })
    if (!state.allowed && !optedOut) {
      // Stop tracking and remove HubSpot's cookies.
      optedOut = true
      hsp('revokeCookieConsent')
      hsq('doNotTrack')
    } else if (state.allowed && optedOut) {
      optedOut = false
      hsq('doNotTrack', { track: true })
    }
  }

  return {
    name: 'hubspot',
    category: options.category ?? 'marketing',
    cookies: HUBSPOT_COOKIES,
    withdrawal: 'stop',

    async load(ctx) {
      if (typeof window === 'undefined') return
      const id = vendorId(options.portalId, /^\d{1,12}$/, 'hubspot', 'portalId')
      if (!id) return
      // This library asks for consent; HubSpot's own banner would ask a second time.
      window.disableHubSpotCookieBanner = true
      window._hsq = window._hsq || []
      window._hsp = window._hsp || []
      applyConsent(ctx.consent())
      const host = options.region === 'eu1' ? 'js-eu1.hs-scripts.com' : 'js.hs-scripts.com'
      await ctx.loadScript(options.scriptUrl ?? `https://${host}/${id}.js`)
    },

    consentChanged(state) {
      if (typeof window !== 'undefined' && window._hsq) applyConsent(state)
    },

    track(event: PluginEvent) {
      if (typeof window === 'undefined' || !window._hsq) return
      if (event.name === 'page_view') {
        // The script records the page it loads on; report later navigations.
        if (firstPageView) {
          firstPageView = false
          return
        }
        if (options.pageViews === false) return
        hsq('setPath', pathOf(event.params.url, event.params.path))
        hsq('trackPageView')
        return
      }
      const mapped = options.events?.[event.name]
      if (mapped) hsq('trackCustomBehavioralEvent', { name: mapped, properties: event.params })
    },
  }
}
