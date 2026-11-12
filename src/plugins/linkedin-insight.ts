// LinkedIn Insight Tag (snap.licdn.com/li.lms-analytics/insight.min.js). Vendor API:
// window.lintrk. The tag has no way to stop it once running, so a withdrawal reloads the page.
import type { AnalyticsPlugin, PluginEvent } from './types'
import { vendorId } from './util'
import { LINKEDIN_INSIGHT_COOKIES } from './vendor-cookies'

export interface LinkedInInsightOptions {
  /** Insight Tag partner ID. */
  partnerId: string | number
  /** Site event -> LinkedIn conversion ID, sent with lintrk('track', { conversion_id }). */
  conversions?: Record<string, string | number>
  /** Override the insight.min.js URL. */
  scriptUrl?: string
}

type Lintrk = ((action: string, data?: unknown) => void) & { q?: unknown[][] }

declare global {
  interface Window {
    lintrk?: Lintrk
    _linkedin_partner_id?: string
    _linkedin_data_partner_ids?: string[]
  }
}

export function linkedInInsight(options: LinkedInInsightOptions): AnalyticsPlugin {
  return {
    name: 'linkedInInsight',
    category: 'marketing',
    cookies: LINKEDIN_INSIGHT_COOKIES,
    withdrawal: 'reload',

    async load(ctx) {
      if (typeof window === 'undefined') return
      const id = vendorId(options.partnerId, /^\d{1,20}$/, 'linkedInInsight', 'partnerId')
      if (!id) return
      // LinkedIn's standard bootstrap.
      window._linkedin_partner_id = id
      window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || []
      if (!window._linkedin_data_partner_ids.includes(id))
        window._linkedin_data_partner_ids.push(id)
      if (!window.lintrk) {
        const queue: Lintrk = (action, data) => queue.q!.push([action, data])
        queue.q = []
        window.lintrk = queue
      }
      await ctx.loadScript(
        options.scriptUrl ?? 'https://snap.licdn.com/li.lms-analytics/insight.min.js',
      )
    },

    track(event: PluginEvent) {
      if (typeof window === 'undefined' || !window.lintrk) return
      const conversion = options.conversions?.[event.name]
      if (conversion === undefined) return
      const conversionId = Number(conversion)
      if (Number.isFinite(conversionId)) window.lintrk('track', { conversion_id: conversionId })
    },
  }
}
