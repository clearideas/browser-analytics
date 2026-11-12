// Microsoft Advertising Universal Event Tracking (UET / Bing Ads).
import { isAttributionFromMicrosoftAds } from '../attribution'
import { trackUETConversion, trackUETEvent } from '../integrations'
import type { AnalyticsPlugin, PluginConsentState, PluginEvent } from './types'
import { MICROSOFT_UET_COOKIES } from './vendor-cookies'

export interface MicrosoftUetOptions {
  /** UET tag ID. Required when loadScript is true. */
  tagId?: string
  /** Event name -> UET goal ID. Conversions fire only for Microsoft Ads traffic unless forced. */
  goals?: Record<string, string>
  /** true (default): load bat.js after consent. false: use a uetq the page installs. */
  loadScript?: boolean
  /** Override the bat.js URL. */
  scriptUrl?: string
  /**
   * "custom" (default): forward the site's own events. UET records page loads itself, so
   * this library's automatic events (page_view, web_vital, ...) are not forwarded.
   * "all": forward every event (the pre-plugin behavior).
   */
  events?: 'custom' | 'all'
}

const AUTOMATIC_EVENTS = new Set([
  'page_view',
  'page_exit',
  'scroll_depth',
  'time_spent',
  'outbound_link_click',
  'web_vital',
  'auto_metrics',
])

declare global {
  interface Window {
    uetq?: any
    UET?: new (options: Record<string, unknown>) => any
  }
}

export function microsoftUet(options: MicrosoftUetOptions): AnalyticsPlugin {
  let lastConsent: boolean | null = null
  let pageLoadSent = false

  const push = (...args: unknown[]) => {
    if (typeof window !== 'undefined' && window.uetq) window.uetq.push(...args)
  }

  const updateConsent = (state: PluginConsentState) => {
    if (lastConsent === state.allowed) return
    lastConsent = state.allowed
    push('consent', 'update', { ad_storage: state.allowed ? 'granted' : 'denied' })
    // With a page-installed tag, send the page load once consent is granted.
    if (state.allowed && options.loadScript === false && !pageLoadSent) {
      pageLoadSent = true
      push('pageLoad')
    }
  }

  return {
    name: 'microsoftUet',
    category: 'marketing',
    cookies: MICROSOFT_UET_COOKIES,

    load(ctx) {
      if (typeof window === 'undefined') return
      if (options.loadScript === false) {
        if (!window.uetq)
          console.warn('[Analytics] microsoftUet: loadScript is false but the page has no uetq')
        return
      }
      if (!options.tagId) {
        console.warn('[Analytics] microsoftUet: tagId is required to load the UET tag')
        return
      }

      window.uetq = window.uetq || []
      push('consent', 'default', { ad_storage: 'denied' })
      updateConsent(ctx.consent())
      ctx
        .loadScript(options.scriptUrl ?? 'https://bat.bing.com/bat.js')
        .then(() => {
          // Standard UET bootstrap: replace the queue with the tag, which replays it.
          if (typeof window.UET === 'function' && Array.isArray(window.uetq)) {
            window.uetq = new window.UET({ ti: options.tagId, q: window.uetq })
            window.uetq.push('pageLoad')
            pageLoadSent = true
          }
        })
        .catch(() => ctx.debug('bat.js failed to load (blocked?)'))
    },

    consentChanged(state) {
      updateConsent(state)
    },

    track(event: PluginEvent, ctx) {
      if (typeof window === 'undefined' || !window.uetq) return
      const { name, props, attribution } = event
      const goalId = props.goal_id || options.goals?.[name]
      const forced = props.force_ms_conversion === true

      if (goalId && (forced || isAttributionFromMicrosoftAds(attribution))) {
        trackUETConversion(goalId, props.value, props.currency)
        ctx.debug('Conversion sent', { name, goalId, forced })
        return
      }
      if ((options.events ?? 'custom') !== 'all' && AUTOMATIC_EVENTS.has(name)) return

      if (goalId) {
        // A goal is configured but the visitor did not come from Microsoft Ads.
        trackUETEvent(name, props.category || 'general', props.value)
        return
      }

      switch (name) {
        case 'sign_up':
          trackUETEvent('signup', props.method || 'unknown', props.value)
          break
        case 'lead':
          trackUETEvent('lead', props.source || 'unknown', props.value)
          break
        case 'contact':
          trackUETEvent('contact', props.method || 'form', props.value)
          break
        default:
          trackUETEvent(name, props.category || 'general', props.value)
      }
    },
  }
}
