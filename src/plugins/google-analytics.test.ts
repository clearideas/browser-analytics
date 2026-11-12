import { beforeEach, describe, expect, it, vi } from 'vitest'

import { consentState, makeConfig, pluginState } from '../../test/helpers'
import { resetLoadedResources } from './dom'
import { googleAnalytics } from './google-analytics'
import type { PluginConsentState, PluginContext } from './types'

const ALLOWED: PluginConsentState = pluginState(consentState({ decision: true }), 'statistics')
const DENIED: PluginConsentState = pluginState(consentState({ decision: false }), 'statistics')

function context(state = ALLOWED): PluginContext {
  return {
    config: makeConfig(),
    consent: () => state,
    debug: () => {},
    loadScript: vi.fn(async () => {}),
    loadStylesheet: vi.fn(async () => {}),
  }
}

const calls = () => (window.dataLayer ?? []).map(args => Array.from(args as ArrayLike<unknown>))

beforeEach(() => {
  resetLoadedResources()
  delete window.dataLayer
  delete window.gtag
})

describe('googleAnalytics plugin (loads gtag.js)', () => {
  it('sets consent before configuration and disables the automatic page view', () => {
    const ctx = context()
    googleAnalytics({ measurementId: 'G-TEST' }).load!(ctx)

    const names = calls().map(call => `${call[0]}:${typeof call[1] === 'string' ? call[1] : ''}`)
    expect(names).toEqual(['consent:default', 'consent:update', 'js:', 'config:G-TEST'])
    expect(calls()[0]![2]).toMatchObject({ ad_storage: 'denied', analytics_storage: 'denied' })
    expect(calls()[1]![2]).toMatchObject({ ad_storage: 'granted', analytics_storage: 'granted' })
    expect(calls()[3]![2]).toEqual({ send_page_view: false })
    expect(ctx.loadScript).toHaveBeenCalledWith(
      'https://www.googletagmanager.com/gtag/js?id=G-TEST',
    )
  })

  it('configures each Google Ads account once', () => {
    const plugin = googleAnalytics({
      measurementId: 'G-TEST',
      adsConversions: { sign_up: 'AW-1/a', purchase: 'AW-1/b', lead: 'AW-2/c' },
    })
    plugin.load!(context())
    plugin.consentChanged!(ALLOWED, context())

    expect(
      calls()
        .filter(call => call[0] === 'config')
        .map(call => call[1]),
    ).toEqual(['G-TEST', 'AW-1', 'AW-2'])
  })

  it('sends page views as GA page_view with page_location, and skips automatic diagnostics', () => {
    const plugin = googleAnalytics({ measurementId: 'G-TEST' })
    plugin.load!(context())
    window.dataLayer!.length = 0

    plugin.track!(
      {
        name: 'page_view',
        params: { url: 'https://x.test/p', path: '/p', title: 'P', referrer: '' },
        props: {},
      },
      context(),
    )
    plugin.track!({ name: 'web_vital', params: { name: 'LCP', value: 1 }, props: {} }, context())
    plugin.track!({ name: 'page_exit', params: {}, props: {} }, context())
    plugin.track!({ name: 'sign_up', params: { plan: 'pro' }, props: { plan: 'pro' } }, context())

    expect(calls()).toEqual([
      [
        'event',
        'page_view',
        {
          page_location: 'https://x.test/p',
          page_path: '/p',
          page_title: 'P',
          page_referrer: undefined,
        },
      ],
      ['event', 'sign_up', { plan: 'pro' }],
    ])
  })

  it('updates consent when it changes, once per change', () => {
    const plugin = googleAnalytics({ measurementId: 'G-TEST' })
    plugin.load!(context())
    window.dataLayer!.length = 0

    plugin.consentChanged!(ALLOWED, context())
    plugin.consentChanged!(DENIED, context())
    plugin.consentChanged!(DENIED, context())

    expect(calls()).toEqual([
      ['consent', 'update', expect.objectContaining({ ad_storage: 'denied' })],
    ])
  })
})

describe('googleAnalytics plugin (page-installed gtag)', () => {
  it('uses the existing gtag and forwards all events unchanged', () => {
    const gtag = vi.fn()
    window.gtag = gtag
    const plugin = googleAnalytics({ measurementId: 'G-TEST', loadScript: false, events: 'all' })
    const ctx = context()

    plugin.load!(ctx)
    plugin.consentChanged!(ALLOWED, ctx)
    plugin.track!({ name: 'web_vital', params: { name: 'LCP' }, props: {} }, ctx)

    expect(ctx.loadScript).not.toHaveBeenCalled()
    expect(gtag.mock.calls).toEqual([
      ['consent', 'update', expect.objectContaining({ ad_storage: 'granted' })],
      ['event', 'web_vital', { name: 'LCP' }],
    ])
  })

  it('warns when the page has no gtag', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    googleAnalytics({ measurementId: 'G-TEST', loadScript: false }).load!(context())
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no gtag'))
  })
})

describe('Google Ads conversions', () => {
  const setup = () => {
    const gtag = vi.fn()
    window.gtag = gtag
    const plugin = googleAnalytics({
      loadScript: false,
      adsConversions: { sign_up: 'AW-1/signup' },
    })
    return {
      gtag,
      plugin,
      conversions: () => gtag.mock.calls.filter(call => call[1] === 'conversion'),
    }
  }

  it('fires for traffic from Google Ads', () => {
    const { plugin, conversions } = setup()
    plugin.track!(
      { name: 'sign_up', params: {}, props: {}, attribution: { gclid: 'abc' } },
      context(),
    )
    expect(conversions()).toEqual([
      ['event', 'conversion', { send_to: 'AW-1/signup', transport_type: 'beacon' }],
    ])
  })

  it('does not fire for other traffic', () => {
    const { plugin, conversions } = setup()
    plugin.track!(
      { name: 'sign_up', params: {}, props: {}, attribution: { utm_source: 'newsletter' } },
      context(),
    )
    plugin.track!({ name: 'sign_up', params: {}, props: {} }, context())
    expect(conversions()).toEqual([])
  })

  it('can be forced or targeted per event', () => {
    const { plugin, conversions } = setup()
    plugin.track!({ name: 'sign_up', params: {}, props: { force_ads_conversion: true } }, context())
    plugin.track!(
      {
        name: 'other',
        params: {},
        props: { ads_send_to: 'AW-9/x', transport_type: 'xhr' },
        attribution: { gbraid: 'g' },
      },
      context(),
    )
    expect(conversions()).toEqual([
      ['event', 'conversion', { send_to: 'AW-1/signup', transport_type: 'beacon' }],
      ['event', 'conversion', { send_to: 'AW-9/x', transport_type: 'xhr' }],
    ])
  })
})

describe('consent categories', () => {
  it('statistics only: analytics storage granted, ad signals denied, no Ads conversions', () => {
    const gtag = vi.fn()
    window.gtag = gtag
    const statisticsOnly = pluginState(
      consentState({ decision: { statistics: true } }),
      'statistics',
    )
    const plugin = googleAnalytics({
      measurementId: 'G-1',
      loadScript: false,
      adsConversions: { sign_up: 'AW-1/x' },
    })

    plugin.consentChanged!(statisticsOnly, context(statisticsOnly))
    plugin.track!(
      { name: 'sign_up', params: {}, props: {}, attribution: { gclid: 'g' } },
      context(statisticsOnly),
    )

    expect(gtag.mock.calls).toEqual([
      [
        'consent',
        'update',
        {
          analytics_storage: 'granted',
          ad_storage: 'denied',
          ad_user_data: 'denied',
          ad_personalization: 'denied',
        },
      ],
      ['event', 'sign_up', {}],
    ])
  })

  it('needs statistics for analytics, or marketing when used for Ads only', () => {
    expect(googleAnalytics({ measurementId: 'G-1' }).category).toBe('statistics')
    expect(googleAnalytics({ adsConversions: { a: 'AW-1/x' } }).category).toBe('marketing')
  })
})
