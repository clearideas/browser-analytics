import { describe, expect, it, vi } from 'vitest'

import { pluginContext, pluginStates } from '../../test/helpers'
import { intercom } from './intercom'

const { allowed, denied } = pluginStates('preferences')
const calls = () => (window.Intercom as any).q as unknown[][]

describe('intercom plugin', () => {
  it('installs Intercom’s queue, boots with the region’s API host, then loads the widget', async () => {
    const ctx = pluginContext(allowed)
    await intercom({ appId: 'abc123', region: 'eu', settings: { hide_default_launcher: true } })
      .load!(ctx)

    expect(calls()).toEqual([
      [
        'boot',
        {
          hide_default_launcher: true,
          api_base: 'https://api-iam.eu.intercom.io',
          app_id: 'abc123',
        },
      ],
    ])
    expect(window.intercomSettings).toEqual({
      api_base: 'https://api-iam.eu.intercom.io',
      app_id: 'abc123',
    })
    expect(ctx.loadScript).toHaveBeenCalledWith('https://widget.intercom.io/widget/abc123')
  })

  it('defaults to the preferences category, and can be reclassified', () => {
    expect(intercom({ appId: 'a' }).category).toBe('preferences')
    expect(intercom({ appId: 'a', category: 'necessary' }).category).toBe('necessary')
  })

  it('refuses an invalid app ID', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ctx = pluginContext(allowed)
    await intercom({ appId: 'x/../evil' }).load!(ctx)
    expect(ctx.loadScript).not.toHaveBeenCalled()
  })

  it('warns about a user without identity verification', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await intercom({ appId: 'a', user: { user_id: 'u1', email: 'u@example.test' } }).load!(
      pluginContext(allowed),
    )
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('identity verification'))
    expect(calls()[0]![1]).toMatchObject({ user_id: 'u1', email: 'u@example.test' })
  })

  it('withdrawal shuts Intercom down; a new grant boots it again', async () => {
    const plugin = intercom({ appId: 'a' })
    await plugin.load!(pluginContext(allowed))
    plugin.consentChanged!(denied, pluginContext(denied))
    plugin.consentChanged!(allowed, pluginContext(allowed))
    expect(calls().map(c => c[0])).toEqual(['boot', 'shutdown', 'boot'])
  })

  it('refreshes on later page views; sends custom events only when asked', async () => {
    const page = { name: 'page_view', params: {}, props: {} }
    const plain = intercom({ appId: 'a' })
    const ctx = pluginContext(allowed)
    await plain.load!(ctx)
    plain.track!(page, ctx)
    plain.track!(page, ctx)
    plain.track!({ name: 'sign_up', params: {}, props: {} }, ctx)
    expect(calls().map(c => c[0])).toEqual(['boot', 'update'])

    delete window.Intercom
    const withEvents = intercom({ appId: 'a', events: 'custom' })
    await withEvents.load!(ctx)
    withEvents.track!({ name: 'sign_up', params: { plan: 'pro' }, props: {} }, ctx)
    withEvents.track!({ name: 'scroll_depth', params: {}, props: {} }, ctx)
    expect(calls().slice(1)).toEqual([['trackEvent', 'sign_up', { plan: 'pro' }]])
  })
})
