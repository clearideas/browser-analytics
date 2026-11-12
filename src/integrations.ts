// Helpers shared by integrations. The integrations themselves are plugins in ./plugins.
import type {} from './plugins/microsoft-uet' // window.uetq typing

// UET-specific tracking functions
export function trackUETEvent(
  eventAction: string,
  eventLabel?: string,
  eventValue?: number,
  customParameters?: Record<string, any>,
): void {
  if (typeof window === 'undefined' || !window.uetq) return

  const eventData: any = {
    ec: 'Custom', // Event Category
    ea: eventAction, // Event Action
  }

  if (eventLabel) {
    eventData.el = eventLabel // Event Label
  }

  if (eventValue !== undefined) {
    eventData.ev = eventValue // Event Value
  }

  // Add custom parameters
  if (customParameters) {
    Object.assign(eventData, customParameters)
  }

  window.uetq.push('event', eventData)
}

export function trackUETConversion(
  goalId?: string,
  revenue?: number,
  currency: string = 'USD',
): void {
  if (typeof window === 'undefined' || !window.uetq) return

  const conversionData: any = {}

  if (goalId) {
    conversionData.gv = goalId // Goal Value (custom goal ID)
  }

  if (revenue !== undefined) {
    conversionData.rv = revenue // Revenue Value
    conversionData.rc = currency // Revenue Currency
  }

  window.uetq.push('event', 'conversion', conversionData)
}

// Keys that steer this library or carry identifiers/attribution. They are used to make
// decisions here but are never forwarded as analytics event parameters.
const NON_FORWARDED_EVENT_KEYS = new Set([
  'attribution',
  'gclid',
  'gbraid',
  'wbraid',
  'gtm_debug',
  'msclkid',
  'bat_debug',
  'fbclid',
  'ads_send_to',
  'force_ads_conversion',
  'transport_type',
  'goal_id',
  'force_ms_conversion',
  'openai_event_name',
  'openai_custom_event_name',
  'openai_event_data',
  'openai_event_options',
])

/** The parameters of an event that may be sent to third-party analytics (e.g. GA4). */
export function toThirdPartyEventParams(eventProps: Record<string, any>): Record<string, any> {
  const params: Record<string, any> = {}
  for (const [key, value] of Object.entries(eventProps)) {
    if (!NON_FORWARDED_EVENT_KEYS.has(key)) params[key] = value
  }
  return params
}
