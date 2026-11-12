// Hotjar (static.hotjar.com/c/hotjar-<site>.js): heatmaps, recordings and surveys.
// Vendor API: window.hj. Hotjar cannot be stopped once running, so a withdrawal reloads
// the page.
import type { AnalyticsPlugin, PluginEvent } from './types'
import { AUTOMATIC_EVENTS, vendorId } from './util'
import { HOTJAR_COOKIES, HOTJAR_STORAGE } from './vendor-cookies'

export interface HotjarOptions {
  /** Hotjar site ID. */
  siteId: string | number
  /** 'none' (default): no events. 'custom': the site's own event names, via hj('event'). */
  events?: 'none' | 'custom'
  /** Override the script URL (e.g. when your account uses a newer Hotjar/Contentsquare tag). */
  scriptUrl?: string
}

type Hj = ((...args: unknown[]) => void) & { q?: unknown[] }

declare global {
  interface Window {
    hj?: Hj
    _hjSettings?: { hjid: number; hjsv: number }
  }
}

const SNIPPET_VERSION = 6

export function hotjar(options: HotjarOptions): AnalyticsPlugin {
  return {
    name: 'hotjar',
    category: 'statistics',
    cookies: HOTJAR_COOKIES,
    storage: HOTJAR_STORAGE,
    withdrawal: 'reload',

    async load(ctx) {
      if (typeof window === 'undefined') return
      const id = vendorId(options.siteId, /^\d{1,12}$/, 'hotjar', 'siteId')
      if (!id) return
      // Hotjar's standard bootstrap.
      if (!window.hj) {
        const queue: Hj = (...args: unknown[]) => {
          ;(queue.q = queue.q || []).push(args)
        }
        window.hj = queue
      }
      window._hjSettings = { hjid: Number(id), hjsv: SNIPPET_VERSION }
      await ctx.loadScript(
        options.scriptUrl ?? `https://static.hotjar.com/c/hotjar-${id}.js?sv=${SNIPPET_VERSION}`,
      )
    },

    track(event: PluginEvent) {
      if (typeof window === 'undefined' || !window.hj) return
      if (options.events === 'custom' && !AUTOMATIC_EVENTS.has(event.name)) {
        window.hj('event', event.name)
      }
    },
  }
}
