// Global test isolation for the happy-dom environment.
//
// The library attaches listeners to window/document and starts intervals that it
// never removes (see stopAutoTracking). Without cleanup, state from one test
// leaks into the next, so we record and undo them after every test.
import { afterEach, beforeEach, vi } from 'vitest'

type ListenerRecord = [EventTarget, string, EventListenerOrEventListenerObject, unknown]
const listeners: ListenerRecord[] = []
const intervals: number[] = []

function trackListeners(target: EventTarget) {
  const original = target.addEventListener.bind(target)
  target.addEventListener = ((type: string, listener: any, options?: any) => {
    listeners.push([target, type, listener, options])
    return original(type, listener, options)
  }) as typeof target.addEventListener
}

trackListeners(window)
trackListeners(document)

// Pending timeouts too: an instance started in one test (e.g. its deferred start-up)
// must not wake up during the next test and send events to that test's fake backend.
const timeouts = new Set<number>()
const originalSetTimeout = window.setTimeout.bind(window)
const originalClearTimeout = window.clearTimeout.bind(window)
window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
  const id = originalSetTimeout(
    (...callbackArgs: unknown[]) => {
      timeouts.delete(id)
      if (typeof handler === 'function') handler(...callbackArgs)
    },
    timeout,
    ...args,
  )
  timeouts.add(id)
  return id
}) as typeof window.setTimeout
window.clearTimeout = ((id?: number) => {
  if (id !== undefined) timeouts.delete(id)
  originalClearTimeout(id)
}) as typeof window.clearTimeout

const originalSetInterval = window.setInterval.bind(window)
window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
  const id = originalSetInterval(handler, timeout, ...args)
  intervals.push(id)
  return id
}) as typeof window.setInterval

// Mutation observers (consent-gated scripts watch the document): disconnected after each
// test so an instance from one test never reacts to the next test's DOM.
const observers: MutationObserver[] = []
const NativeMutationObserver = window.MutationObserver
window.MutationObserver = class extends NativeMutationObserver {
  constructor(callback: MutationCallback) {
    super(callback)
    observers.push(this)
  }
} as typeof MutationObserver
globalThis.MutationObserver = window.MutationObserver

const VENDOR_GLOBALS = [
  '_hsq',
  '_hsp',
  'disableHubSpotCookieBanner',
  'Intercom',
  'intercomSettings',
  'fbq',
  '_fbq',
  'lintrk',
  '_linkedin_partner_id',
  '_linkedin_data_partner_ids',
  'clarity',
  'hj',
  '_hjSettings',
  '__ciAnalyticsPlugins',
  'gtag',
  'dataLayer',
  'uetq',
  'oaiq',
  'ClearIdeasWidget',
  'clearIdeasWidget',
  'analytics',
  'ciAnalytics',
  'disableOwnerTracking',
  'enableOwnerTracking',
  'ownerTrackingStatus',
  'showCookieBanner',
  'getAttributionContext',
  'enableDebug',
  'disableDebug',
  'debugStatus',
  'ClearIdeasAnalytics',
  'ciAnalyticsConfig',
  'ciAnalyticsQueue',
]

export function clearAllCookies(): void {
  // A cookie can only be deleted with the same Domain it was set with, so try
  // host-only plus every parent domain (www.example.test, example.test, test).
  const labels = window.location.hostname.split('.')
  const domains = labels.map((_, i) => labels.slice(i).join('.'))
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0]?.trim()
    if (!name) continue
    document.cookie = `${name}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/`
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Domain=${domain}`
      document.cookie = `${name}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Domain=.${domain}`
    }
  }
}

beforeEach(() => {
  // Never allow real network traffic from unit tests. Tests opt in via mockApi().
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      throw new Error(`Unmocked fetch in test: ${url}`)
    }),
  )
})

afterEach(() => {
  // First restore the native history methods (the browser integration wraps them), so the
  // URL reset below cannot notify this test's instance, which would then record a page
  // view into the next test. Re-imported modules would also stack wrappers otherwise.
  for (const method of ['pushState', 'replaceState'] as const) {
    if (Object.prototype.hasOwnProperty.call(window.history, method))
      delete (window.history as any)[method]
  }
  for (const [target, type, listener, options] of listeners.splice(0)) {
    target.removeEventListener(type, listener, options as any)
  }
  for (const id of intervals.splice(0)) window.clearInterval(id)
  for (const observer of observers.splice(0)) observer.disconnect()
  for (const id of timeouts) originalClearTimeout(id)
  timeouts.clear()

  localStorage.clear()
  sessionStorage.clear()
  clearAllCookies()
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  window.history.replaceState(null, '', '/')
  for (const key of VENDOR_GLOBALS) delete (window as any)[key]

  // Undo per-test document overrides (setPageHidden / setReferrer)
  delete (document as any).visibilityState
  delete (document as any).hidden
  delete (document as any).referrer
  delete (navigator as any).globalPrivacyControl

  vi.useRealTimers()
  vi.resetModules()
})
