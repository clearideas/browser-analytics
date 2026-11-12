import { describe, expect, it, vi } from 'vitest'

import { pluginContext, pluginStates } from '../../test/helpers'
import { hubspot } from './hubspot'

const { allowed, denied } = pluginStates()
const hsq = () => window._hsq as unknown[][]
const hsp = () => window._hsp as unknown[][]

describe('hubspot plugin', () => {
  it('turns off HubSpot’s own banner, passes consent, then loads the tracking code', async () => {
    const ctx = pluginContext(allowed)
    await hubspot({ portalId: 1234567 }).load!(ctx)

    expect(window.disableHubSpotCookieBanner).toBe(true)
    expect(hsp()).toEqual([
      ['setHubSpotConsent', { analytics: true, advertisement: true, functionality: true }],
    ])
    expect(ctx.loadScript).toHaveBeenCalledWith('https://js.hs-scripts.com/1234567.js')
  })

  it('uses the EU data center host', async () => {
    const ctx = pluginContext(allowed)
    await hubspot({ portalId: '42', region: 'eu1' }).load!(ctx)
    expect(ctx.loadScript).toHaveBeenCalledWith('https://js-eu1.hs-scripts.com/42.js')
  })

  it('refuses a portal ID that is not a number (it becomes part of the script URL)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ctx = pluginContext(allowed)
    await hubspot({ portalId: '1/../../evil.example/x' }).load!(ctx)
    expect(ctx.loadScript).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
  })

  it('maps category choices onto HubSpot’s categories', async () => {
    const plugin = hubspot({ portalId: 1, category: 'statistics' })
    const ctx = pluginContext({
      ...allowed,
      allowedCategories: {
        necessary: true,
        preferences: false,
        statistics: true,
        marketing: false,
      },
    })
    await plugin.load!(ctx)
    expect(hsp()[0]).toEqual([
      'setHubSpotConsent',
      { analytics: true, advertisement: false, functionality: false },
    ])
    expect(plugin.category).toBe('statistics')
  })

  it('withdrawal revokes cookie consent and stops tracking; a new grant resumes it', async () => {
    const plugin = hubspot({ portalId: 1 })
    await plugin.load!(pluginContext(allowed))

    plugin.consentChanged!(denied, pluginContext(denied))
    expect(hsp()).toContainEqual(['revokeCookieConsent'])
    expect(hsq()).toContainEqual(['doNotTrack'])

    plugin.consentChanged!(allowed, pluginContext(allowed))
    expect(hsq()).toContainEqual(['doNotTrack', { track: true }])
  })

  it('reports later page views (HubSpot counts the first itself) and mapped events only', async () => {
    const plugin = hubspot({ portalId: 1, events: { sign_up: 'pe1_sign_up' } })
    const ctx = pluginContext(allowed)
    await plugin.load!(ctx)
    const view = (path: string) => ({
      name: 'page_view',
      params: { url: `https://site.test${path}`, path },
      props: {},
    })

    plugin.track!(view('/'), ctx)
    plugin.track!(view('/pricing?utm_source=x'), ctx)
    plugin.track!({ name: 'sign_up', params: { plan: 'pro' }, props: {} }, ctx)
    plugin.track!({ name: 'unmapped', params: {}, props: {} }, ctx)

    expect(hsq()).toEqual([
      ['setPath', '/pricing?utm_source=x'],
      ['trackPageView'],
      ['trackCustomBehavioralEvent', { name: 'pe1_sign_up', properties: { plan: 'pro' } }],
    ])
  })

  it('pageViews: false leaves navigations to HubSpot', async () => {
    const plugin = hubspot({ portalId: 1, pageViews: false })
    const ctx = pluginContext(allowed)
    await plugin.load!(ctx)
    plugin.track!({ name: 'page_view', params: { path: '/' }, props: {} }, ctx)
    plugin.track!({ name: 'page_view', params: { path: '/b' }, props: {} }, ctx)
    expect(hsq()).toEqual([])
  })
})
