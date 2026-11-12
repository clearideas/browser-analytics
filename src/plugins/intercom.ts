// Intercom Messenger (widget.intercom.io). Vendor API: window.Intercom(command, ...).
import type { ConsentCategory } from '../categories'
import type { AnalyticsPlugin, PluginEvent } from './types'
import { AUTOMATIC_EVENTS, vendorId } from './util'
import { INTERCOM_COOKIES, INTERCOM_STORAGE } from './vendor-cookies'

const API_BASE = {
  us: 'https://api-iam.intercom.io',
  eu: 'https://api-iam.eu.intercom.io',
  au: 'https://api-iam.au.intercom.io',
} as const

export interface IntercomUser {
  user_id?: string
  email?: string
  name?: string
  /**
   * Identity verification: HMAC of user_id (or email) computed on your server with
   * Intercom's secret. Without it (or intercom_user_jwt), anyone could pose as this user.
   */
  user_hash?: string
  /** Identity verification with a JWT signed on your server (Intercom's newer method). */
  intercom_user_jwt?: string
  [attribute: string]: unknown
}

export interface IntercomOptions {
  /** Intercom workspace (app) ID. */
  appId: string
  /** Data hosting region of the workspace: 'us' (default), 'eu' or 'au'. */
  region?: keyof typeof API_BASE
  /**
   * Consent category (default 'preferences'). Intercom is a support tool but also records
   * visits and runs product messages; use 'necessary' only if your assessment supports it.
   */
  category?: ConsentCategory
  /** The logged-in user, if any (see user_hash). */
  user?: IntercomUser
  /** 'none' (default): no events. 'custom': the site's own events, via trackEvent. */
  events?: 'none' | 'custom'
  /** Other Messenger settings passed to boot (e.g. { hide_default_launcher: true }). */
  settings?: Record<string, unknown>
  /** Override the widget script URL. */
  scriptUrl?: string
}

type IntercomFn = ((...args: unknown[]) => void) & { q?: unknown[]; c?: (args: unknown) => void }

declare global {
  interface Window {
    Intercom?: IntercomFn
    intercomSettings?: Record<string, unknown>
  }
}

let warnedAboutIdentity = false

export function intercom(options: IntercomOptions): AnalyticsPlugin {
  let booted = false
  let firstPageView = true
  let appId: string | null = null

  const call = (...args: unknown[]) => window.Intercom?.(...args)

  const boot = () => {
    if (!appId) return
    const user = options.user ?? {}
    if ((user.user_id || user.email) && !user.user_hash && !user.intercom_user_jwt) {
      if (!warnedAboutIdentity) {
        warnedAboutIdentity = true
        console.warn(
          '[Analytics] intercom: user without user_hash/intercom_user_jwt. Enable identity verification so visitors cannot pose as other users.',
        )
      }
    }
    const apiBase = API_BASE[options.region ?? 'us'] ?? API_BASE.us
    window.intercomSettings = { api_base: apiBase, app_id: appId }
    call('boot', { ...options.settings, ...user, api_base: apiBase, app_id: appId })
    booted = true
  }

  return {
    name: 'intercom',
    category: options.category ?? 'preferences',
    cookies: INTERCOM_COOKIES,
    storage: INTERCOM_STORAGE,
    withdrawal: 'stop',

    async load(ctx) {
      if (typeof window === 'undefined') return
      appId = vendorId(options.appId, /^[a-z0-9]{1,32}$/i, 'intercom', 'appId')
      if (!appId) return
      // Intercom's standard queue: calls made before the widget loads are replayed by it.
      if (typeof window.Intercom !== 'function') {
        const queue: IntercomFn = (...args: unknown[]) => queue.c!(args)
        queue.q = []
        queue.c = args => queue.q!.push(args)
        window.Intercom = queue
      }
      boot()
      await ctx.loadScript(options.scriptUrl ?? `https://widget.intercom.io/widget/${appId}`)
    },

    consentChanged(state) {
      if (typeof window === 'undefined' || !window.Intercom) return
      if (!state.allowed && booted) {
        // Ends the session and clears Intercom's cookies.
        call('shutdown')
        booted = false
      } else if (state.allowed && !booted) {
        boot()
      }
    },

    track(event: PluginEvent) {
      if (typeof window === 'undefined' || !booted) return
      if (event.name === 'page_view') {
        // boot covers the first page; later navigations refresh the Messenger.
        if (firstPageView) {
          firstPageView = false
          return
        }
        call('update')
        return
      }
      if (options.events === 'custom' && !AUTOMATIC_EVENTS.has(event.name)) {
        call('trackEvent', event.name, event.params)
      }
    },
  }
}
