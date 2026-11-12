// Google Analytics 4 and Google Ads conversions (gtag.js).
import { isAttributionFromGoogleAds } from '../attribution'
import type { AnalyticsPlugin, PluginConsentState, PluginEvent } from './types'
import { GOOGLE_COOKIES } from './vendor-cookies'

export interface GoogleAnalyticsOptions {
  /** GA4 measurement ID ("G-..."). Optional if only Ads conversions are used. */
  measurementId?: string
  /** Event name -> Google Ads conversion ("AW-123456789/label"). */
  adsConversions?: Record<string, string>
  /**
   * true (default): load gtag.js after consent. Google's consent state is set before the
   * tag is configured. false: use a gtag that the page itself installs.
   */
  loadScript?: boolean
  /** Override the gtag.js URL (e.g. a first-party proxy). */
  scriptUrl?: string
  /**
   * Which events to forward. "page_views_and_custom" (default) skips this library's
   * automatic diagnostics (page_exit, web_vital, scroll_depth, ...). "all" forwards
   * everything, with the event's own parameters (the pre-plugin behavior).
   */
  events?: 'page_views_and_custom' | 'all'
}

// Automatic events from this library that are diagnostics rather than analytics.
const AUTOMATIC_EVENTS = new Set([
  'page_exit',
  'scroll_depth',
  'time_spent',
  'outbound_link_click',
  'web_vital',
  'auto_metrics',
])

declare global {
  interface Window {
    gtag?: (...args: any[]) => void
    dataLayer?: any[]
  }
}

// Google Consent Mode v2: analytics_storage follows the statistics category, the ad_*
// signals follow marketing.
function consentFields(allowed: { statistics: boolean; marketing: boolean }) {
  const value = (granted: boolean) => (granted ? 'granted' : 'denied')
  return {
    analytics_storage: value(allowed.statistics),
    ad_storage: value(allowed.marketing),
    ad_user_data: value(allowed.marketing),
    ad_personalization: value(allowed.marketing),
  }
}

function adsAccountIds(conversions: Record<string, string> = {}): string[] {
  const ids = Object.values(conversions)
    .map(value => (typeof value === 'string' ? value.split('/')[0] : undefined))
    .filter((id): id is string => !!id && id.startsWith('AW-'))
  return [...new Set(ids)]
}

export function googleAnalytics(options: GoogleAnalyticsOptions): AnalyticsPlugin {
  const forward = options.events ?? 'page_views_and_custom'
  let lastConsent: string | null = null
  let adsConfigured = false

  const gtag = (...args: unknown[]) => {
    if (typeof window !== 'undefined' && typeof window.gtag === 'function') window.gtag(...args)
  }

  const updateConsent = (state: PluginConsentState) => {
    const fields = consentFields(state.allowedCategories)
    const key = JSON.stringify(fields)
    if (lastConsent === key) return
    lastConsent = key
    gtag('consent', 'update', fields)
  }

  const configureAds = () => {
    if (adsConfigured) return
    adsConfigured = true
    for (const id of adsAccountIds(options.adsConversions)) gtag('config', id)
  }

  return {
    name: 'googleAnalytics',
    // Analytics needs statistics consent; used only for Ads conversions, marketing.
    category: options.measurementId ? 'statistics' : 'marketing',
    cookies: GOOGLE_COOKIES,

    load(ctx) {
      if (typeof window === 'undefined') return

      if (options.loadScript === false) {
        if (typeof window.gtag !== 'function') {
          console.warn('[Analytics] googleAnalytics: loadScript is false but the page has no gtag')
        }
        return
      }

      window.dataLayer = window.dataLayer || []
      if (typeof window.gtag !== 'function') {
        window.gtag = function gtag() {
          // gtag.js expects the arguments object itself

          window.dataLayer!.push(arguments)
        }
      }
      // Consent first, then configuration: nothing is processed under an unknown state.
      gtag('consent', 'default', {
        ...consentFields({ statistics: false, marketing: false }),
        wait_for_update: 500,
      })
      updateConsent(ctx.consent())
      gtag('js', new Date())
      if (options.measurementId) gtag('config', options.measurementId, { send_page_view: false })
      if (ctx.consent().allowedCategories.marketing) configureAds()

      const id = options.measurementId ?? adsAccountIds(options.adsConversions)[0]
      const src =
        options.scriptUrl ??
        (id ? `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}` : undefined)
      if (src) {
        // Commands queue in dataLayer until the script runs; no need to wait for it.
        ctx.loadScript(src).catch(() => ctx.debug('gtag.js failed to load (blocked?)'))
      }
    },

    consentChanged(state) {
      updateConsent(state)
      if (state.allowedCategories.marketing) configureAds()
    },

    track(event: PluginEvent, ctx) {
      const { name, params, props, attribution } = event

      if (forward === 'all') {
        gtag('event', name, params)
      } else if (name === 'page_view') {
        gtag('event', 'page_view', {
          page_location: params.url,
          page_path: params.path,
          page_title: params.title ?? params.pageTitle,
          page_referrer: params.referrer || undefined,
        })
      } else if (!AUTOMATIC_EVENTS.has(name)) {
        gtag('event', name, params)
      }

      // Google Ads conversion: needs marketing consent, and traffic from Google Ads unless
      // forced.
      const conversionId = props.ads_send_to || options.adsConversions?.[name]
      if (
        conversionId &&
        ctx.consent().allowedCategories.marketing &&
        (props.force_ads_conversion === true || isAttributionFromGoogleAds(attribution))
      ) {
        gtag('event', 'conversion', {
          send_to: conversionId,
          transport_type: props.transport_type || 'beacon',
        })
      }
    },
  }
}
