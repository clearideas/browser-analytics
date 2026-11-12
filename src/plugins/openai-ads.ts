// OpenAI Ads Measurement Pixel.
import type { OpenAIAdsEventConfig, OpenAIAdsEventName } from '../types'
import type { AnalyticsPlugin, PluginEvent } from './types'

export interface OpenAIAdsOptions {
  /** Public pixel ID. */
  pixelId: string
  /** Event name -> OpenAI Ads event (or just its name). Defaults cover common events. */
  events?: Record<string, OpenAIAdsEventConfig | string>
  /** Enable the pixel's debug logging. */
  debug?: boolean
  /** Override the pixel script URL. */
  scriptUrl?: string
}

declare global {
  interface Window {
    oaiq?: (...args: any[]) => void
  }
}

const OPENAI_ADS_SCRIPT_URL = 'https://bzrcdn.openai.com/sdk/oaiq.min.js'

const DEFAULT_OPENAI_ADS_EVENTS: Record<string, OpenAIAdsEventConfig> = {
  sign_up: {
    eventName: 'lead_created',
    type: 'customer_action',
  },
  sign_up_start: {
    eventName: 'lead_created',
    type: 'customer_action',
  },
  signup_start: {
    eventName: 'lead_created',
    type: 'customer_action',
  },
  signup_complete: {
    eventName: 'registration_completed',
    type: 'customer_action',
  },
  sign_up_complete: {
    eventName: 'registration_completed',
    type: 'customer_action',
  },
  trial_started: {
    eventName: 'trial_started',
    type: 'plan_enrollment',
    data: {
      plan_id: 'free_trial',
    },
  },
  submit_contact_form: {
    eventName: 'lead_created',
    type: 'customer_action',
  },
  newsletter_signup: {
    eventName: 'custom',
    type: 'custom',
    customEventName: 'newsletter_signup',
  },
  intent_pricing_view: {
    eventName: 'page_viewed',
    type: 'contents',
    data: {
      contents: [
        {
          id: 'pricing',
          name: 'Pricing page',
          content_type: 'page',
        },
      ],
    },
  },
}

function getOpenAIAdsEventConfig(
  events: OpenAIAdsOptions['events'],
  eventName: string,
  eventProps: Record<string, any>,
): OpenAIAdsEventConfig | null {
  const manualEventName = eventProps.openai_event_name
  const configuredEvent = events?.[eventName] ?? DEFAULT_OPENAI_ADS_EVENTS[eventName]

  if (!manualEventName && !configuredEvent) return null

  const baseConfig: OpenAIAdsEventConfig =
    typeof configuredEvent === 'string'
      ? { eventName: configuredEvent as OpenAIAdsEventName }
      : configuredEvent || { eventName: manualEventName as OpenAIAdsEventName }

  return {
    ...baseConfig,
    eventName: (manualEventName || baseConfig.eventName) as OpenAIAdsEventName,
    customEventName: eventProps.openai_custom_event_name || baseConfig.customEventName,
    data: {
      ...(baseConfig.data || {}),
      ...(eventProps.openai_event_data || {}),
    },
    options: {
      ...(baseConfig.options || {}),
      ...(eventProps.openai_event_options || {}),
    },
  }
}

function getDefaultOpenAIAdsDataType(eventName: OpenAIAdsEventName): string {
  if (
    eventName === 'page_viewed' ||
    eventName === 'contents_viewed' ||
    eventName === 'items_added' ||
    eventName === 'checkout_started' ||
    eventName === 'order_created'
  ) {
    return 'contents'
  }

  if (
    eventName === 'lead_created' ||
    eventName === 'registration_completed' ||
    eventName === 'appointment_scheduled'
  ) {
    return 'customer_action'
  }

  if (eventName === 'subscription_created' || eventName === 'trial_started') {
    return 'plan_enrollment'
  }

  return 'custom'
}

function buildOpenAIAdsData(
  eventConfig: OpenAIAdsEventConfig,
  eventProps: Record<string, any>,
): Record<string, any> {
  const data = { ...(eventConfig.data || {}) }
  data.type = data.type || eventConfig.type || getDefaultOpenAIAdsDataType(eventConfig.eventName)

  if (data.type === 'contents' && !data.contents && eventProps.path) {
    data.contents = [
      {
        id: String(eventProps.path),
        name: eventProps.pageTitle || eventProps.title || String(eventProps.path),
        content_type: 'page',
      },
    ]
  }

  if (data.type === 'plan_enrollment' && !data.plan_id) {
    data.plan_id = eventProps.plan_id || eventProps.subscription_type || 'default'
  }

  if (typeof eventProps.amount === 'number' && data.amount === undefined) {
    data.amount = Math.round(eventProps.amount)
  }

  if (typeof eventProps.currency === 'string' && data.currency === undefined) {
    data.currency = eventProps.currency
  }

  return data
}

function buildOpenAIAdsOptions(eventConfig: OpenAIAdsEventConfig): Record<string, any> {
  const options = { ...(eventConfig.options || {}) }

  if (eventConfig.eventName === 'custom' && eventConfig.customEventName) {
    options.custom_event_name = eventConfig.customEventName
  }

  return options
}

export function openAIAds(options: OpenAIAdsOptions): AnalyticsPlugin {
  return {
    name: 'openAIAds',
    category: 'marketing',

    load(ctx) {
      if (typeof window === 'undefined') return
      if (typeof window.oaiq !== 'function') {
        const queue = function (...args: any[]) {
          ;(queue as any).q.push(args)
        }
        ;(queue as any).q = []
        window.oaiq = queue
      }
      window.oaiq('init', { pixelId: options.pixelId, debug: options.debug === true })
      ctx
        .loadScript(options.scriptUrl ?? OPENAI_ADS_SCRIPT_URL)
        .catch(() => ctx.debug('OpenAI Ads pixel failed to load (blocked?)'))
    },

    track(event: PluginEvent, ctx) {
      const eventConfig = getOpenAIAdsEventConfig(options.events, event.name, event.props)
      if (!eventConfig) return

      const data = buildOpenAIAdsData(eventConfig, event.props)
      const measureOptions = buildOpenAIAdsOptions(eventConfig)
      if (eventConfig.eventName === 'custom' && !measureOptions.custom_event_name) {
        ctx.debug('Custom event skipped: custom_event_name is required', { name: event.name })
        return
      }

      if (Object.keys(measureOptions).length > 0) {
        window.oaiq?.('measure', eventConfig.eventName, data, measureOptions)
      } else {
        window.oaiq?.('measure', eventConfig.eventName, data)
      }
      ctx.debug('Event sent', { name: event.name, openAIEventName: eventConfig.eventName })
    },
  }
}
