// Meta (Facebook) Pixel (connect.facebook.net/.../fbevents.js). Vendor API: window.fbq.
import type { AnalyticsPlugin, PluginEvent } from './types'
import { vendorId } from './util'
import { META_PIXEL_COOKIES } from './vendor-cookies'

/** Meta's standard events; other mapped names are sent with trackCustom. */
const STANDARD_EVENTS = new Set([
  'AddPaymentInfo',
  'AddToCart',
  'AddToWishlist',
  'CompleteRegistration',
  'Contact',
  'CustomizeProduct',
  'Donate',
  'FindLocation',
  'InitiateCheckout',
  'Lead',
  'PageView',
  'Purchase',
  'Schedule',
  'Search',
  'StartTrial',
  'SubmitApplication',
  'Subscribe',
  'ViewContent',
])

export interface MetaPixelOptions {
  /** Pixel (dataset) ID. */
  pixelId: string | number
  /**
   * Site event -> Meta event, e.g. { sign_up: 'CompleteRegistration', purchase: 'Purchase' }.
   * Standard names use fbq('track'), others fbq('trackCustom'). Events not listed are not
   * sent; page views are always sent as PageView.
   */
  events?: Record<string, string>
  /**
   * Meta's automatic configuration (button clicks and page metadata collected by the pixel
   * itself). Default false: only what this library sends.
   */
  autoConfig?: boolean
  /** Override the fbevents.js URL. */
  scriptUrl?: string
}

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void
  queue: unknown[]
  push?: Fbq
  loaded?: boolean
  version?: string
  disablePushState?: boolean
}

declare global {
  interface Window {
    fbq?: Fbq
    _fbq?: Fbq
  }
}

export function metaPixel(options: MetaPixelOptions): AnalyticsPlugin {
  const fbq = (...args: unknown[]) => window.fbq?.(...args)
  let lastConsent: boolean | null = null
  const sendConsent = (allowed: boolean) => {
    if (allowed === lastConsent) return
    lastConsent = allowed
    fbq('consent', allowed ? 'grant' : 'revoke')
  }

  return {
    name: 'metaPixel',
    category: 'marketing',
    cookies: META_PIXEL_COOKIES,
    withdrawal: 'stop',

    async load(ctx) {
      if (typeof window === 'undefined') return
      const id = vendorId(options.pixelId, /^\d{5,20}$/, 'metaPixel', 'pixelId')
      if (!id) return
      if (!window.fbq) {
        // Meta's standard queue, replayed by fbevents.js when it loads.
        const queue = ((...args: unknown[]) => {
          if (queue.callMethod) queue.callMethod(...args)
          else queue.queue.push(args)
        }) as Fbq
        queue.queue = []
        queue.push = queue
        queue.loaded = true
        queue.version = '2.0'
        window.fbq = queue
        if (!window._fbq) window._fbq = queue
      }
      // Page views come from this library (one per page, SPA navigations included).
      window.fbq.disablePushState = true
      sendConsent(ctx.consent().allowed)
      if (options.autoConfig !== true) fbq('set', 'autoConfig', false, id)
      fbq('init', id)
      await ctx.loadScript(options.scriptUrl ?? 'https://connect.facebook.net/en_US/fbevents.js')
    },

    consentChanged(state) {
      if (typeof window !== 'undefined' && window.fbq) sendConsent(state.allowed)
    },

    track(event: PluginEvent) {
      if (typeof window === 'undefined' || !window.fbq) return
      if (event.name === 'page_view') {
        fbq('track', 'PageView')
        return
      }
      const mapped = options.events?.[event.name]
      if (!mapped) return
      fbq(STANDARD_EVENTS.has(mapped) ? 'track' : 'trackCustom', mapped, event.params)
    },
  }
}
