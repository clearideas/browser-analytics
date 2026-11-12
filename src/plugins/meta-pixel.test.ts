import { describe, expect, it, vi } from 'vitest'

import { pluginContext, pluginStates } from '../../test/helpers'
import { metaPixel } from './meta-pixel'

const { allowed, denied } = pluginStates()
const queue = () => (window.fbq as any).queue as unknown[][]

describe('metaPixel plugin', () => {
  it('sets consent and turns off automatic collection before init, then loads fbevents.js', async () => {
    const ctx = pluginContext(allowed)
    await metaPixel({ pixelId: '1234567890' }).load!(ctx)

    expect(queue()).toEqual([
      ['consent', 'grant'],
      ['set', 'autoConfig', false, '1234567890'],
      ['init', '1234567890'],
    ])
    // Page views come from this library, so the pixel's own history tracking is off.
    expect(window.fbq!.disablePushState).toBe(true)
    expect(ctx.loadScript).toHaveBeenCalledWith('https://connect.facebook.net/en_US/fbevents.js')
  })

  it('autoConfig: true keeps Meta’s automatic configuration', async () => {
    await metaPixel({ pixelId: '1234567890', autoConfig: true }).load!(pluginContext(allowed))
    expect(queue().map(c => c[0])).toEqual(['consent', 'init'])
  })

  it('refuses an invalid pixel ID', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ctx = pluginContext(allowed)
    await metaPixel({ pixelId: 'abc' }).load!(ctx)
    expect(ctx.loadScript).not.toHaveBeenCalled()
  })

  it('withdrawal revokes consent; unchanged consent is not sent again', async () => {
    const plugin = metaPixel({ pixelId: '1234567890' })
    await plugin.load!(pluginContext(allowed))
    plugin.consentChanged!(allowed, pluginContext(allowed))
    expect(queue().filter(c => c[0] === 'consent')).toEqual([['consent', 'grant']])
    plugin.consentChanged!(denied, pluginContext(denied))
    expect(queue()[queue().length - 1]).toEqual(['consent', 'revoke'])
  })

  it('sends PageView per page, and mapped events as standard or custom events', async () => {
    const plugin = metaPixel({
      pixelId: '1234567890',
      events: { sign_up: 'CompleteRegistration', newsletter: 'NewsletterSignup' },
    })
    const ctx = pluginContext(allowed)
    await plugin.load!(ctx)
    queue().length = 0

    plugin.track!({ name: 'page_view', params: {}, props: {} }, ctx)
    plugin.track!({ name: 'sign_up', params: { value: 1 }, props: {} }, ctx)
    plugin.track!({ name: 'newsletter', params: {}, props: {} }, ctx)
    plugin.track!({ name: 'unmapped', params: {}, props: {} }, ctx)

    expect(queue()).toEqual([
      ['track', 'PageView'],
      ['track', 'CompleteRegistration', { value: 1 }],
      ['trackCustom', 'NewsletterSignup', {}],
    ])
  })
})
