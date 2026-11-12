// Microsoft Clarity (www.clarity.ms/tag/<project>): heatmaps and session recordings.
// Vendor API: window.clarity. Withdrawal erases Clarity's cookies and reloads the page,
// so no recording continues in the page that is open.
import type { AnalyticsPlugin, PluginConsentState, PluginEvent } from './types'
import { AUTOMATIC_EVENTS, vendorId } from './util'
import { MICROSOFT_CLARITY_COOKIES } from './vendor-cookies'

export interface MicrosoftClarityOptions {
  /** Clarity project ID. */
  projectId: string
  /** 'none' (default): no events. 'custom': the site's own event names, via clarity('event'). */
  events?: 'none' | 'custom'
  /** Override the tag URL. */
  scriptUrl?: string
}

type Clarity = ((...args: unknown[]) => void) & { q?: unknown[] }

declare global {
  interface Window {
    clarity?: Clarity
  }
}

export function microsoftClarity(options: MicrosoftClarityOptions): AnalyticsPlugin {
  const clarity = (...args: unknown[]) => window.clarity?.(...args)

  // Clarity's consent signal, from our categories.
  const signal = (state: PluginConsentState) => {
    const value = (allowed: boolean) => (state.allowed && allowed ? 'granted' : 'denied')
    clarity('consentv2', {
      analytics_Storage: value(state.allowedCategories.statistics),
      ad_Storage: value(state.allowedCategories.marketing),
    })
  }

  return {
    name: 'microsoftClarity',
    category: 'statistics',
    cookies: MICROSOFT_CLARITY_COOKIES,
    withdrawal: 'reload',

    async load(ctx) {
      if (typeof window === 'undefined') return
      const id = vendorId(options.projectId, /^[a-z0-9]{1,32}$/i, 'microsoftClarity', 'projectId')
      if (!id) return
      if (!window.clarity) {
        // Clarity's standard queue, replayed by the tag.
        const queue: Clarity = (...args: unknown[]) => {
          ;(queue.q = queue.q || []).push(args)
        }
        window.clarity = queue
      }
      signal(ctx.consent())
      await ctx.loadScript(options.scriptUrl ?? `https://www.clarity.ms/tag/${id}`)
    },

    consentChanged(state) {
      if (typeof window === 'undefined' || !window.clarity) return
      signal(state)
      // Erase Clarity's cookies (the page is then reloaded, see withdrawal).
      if (!state.allowed) clarity('consent', false)
    },

    track(event: PluginEvent) {
      if (typeof window === 'undefined' || !window.clarity) return
      if (options.events === 'custom' && !AUTOMATIC_EVENTS.has(event.name)) {
        clarity('event', event.name)
      }
    },
  }
}
