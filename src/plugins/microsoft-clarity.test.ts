import { describe, expect, it, vi } from 'vitest'

import { pluginContext, pluginStates } from '../../test/helpers'
import { microsoftClarity } from './microsoft-clarity'

const { allowed, denied } = pluginStates('statistics')
const queue = () => window.clarity!.q as unknown[][]

describe('microsoftClarity plugin', () => {
  it('signals consent from the categories, then loads the tag', async () => {
    const ctx = pluginContext({
      ...allowed,
      allowedCategories: { necessary: true, preferences: true, statistics: true, marketing: false },
    })
    await microsoftClarity({ projectId: 'abc123' }).load!(ctx)
    expect(queue()).toEqual([['consentv2', { analytics_Storage: 'granted', ad_Storage: 'denied' }]])
    expect(ctx.loadScript).toHaveBeenCalledWith('https://www.clarity.ms/tag/abc123')
  })

  it('withdrawal signals denied and erases Clarity’s cookies; the page is then reloaded', async () => {
    const plugin = microsoftClarity({ projectId: 'abc123' })
    await plugin.load!(pluginContext(allowed))
    plugin.consentChanged!(denied, pluginContext(denied))
    expect(queue().slice(-2)).toEqual([
      ['consentv2', { analytics_Storage: 'denied', ad_Storage: 'denied' }],
      ['consent', false],
    ])
    expect(plugin.withdrawal).toBe('reload')
  })

  it('refuses an invalid project ID', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ctx = pluginContext(allowed)
    await microsoftClarity({ projectId: 'a b' }).load!(ctx)
    expect(ctx.loadScript).not.toHaveBeenCalled()
  })

  it('sends the site’s own event names only when asked', async () => {
    const plugin = microsoftClarity({ projectId: 'abc', events: 'custom' })
    const ctx = pluginContext(allowed)
    await plugin.load!(ctx)
    plugin.track!({ name: 'sign_up', params: { email: 'x' }, props: {} }, ctx)
    plugin.track!({ name: 'page_view', params: {}, props: {} }, ctx)
    expect(queue().slice(1)).toEqual([['event', 'sign_up']])
  })
})
