import { describe, expect, it, vi } from 'vitest'

import { pluginContext, pluginStates } from '../../test/helpers'
import { hotjar } from './hotjar'

const { allowed } = pluginStates('statistics')

describe('hotjar plugin', () => {
  it('sets up Hotjar’s settings and loads the tag', async () => {
    const ctx = pluginContext(allowed)
    await hotjar({ siteId: '123456' }).load!(ctx)
    expect(window._hjSettings).toEqual({ hjid: 123456, hjsv: 6 })
    expect(ctx.loadScript).toHaveBeenCalledWith('https://static.hotjar.com/c/hotjar-123456.js?sv=6')
  })

  it('cannot be stopped once running: withdrawal reloads the page; declares its cookies and storage', () => {
    const plugin = hotjar({ siteId: 1 })
    expect(plugin.withdrawal).toBe('reload')
    expect(plugin.cookies).toEqual(['_hj*'])
    expect(plugin.storage).toEqual(['_hj*'])
  })

  it('refuses an invalid site ID', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ctx = pluginContext(allowed)
    await hotjar({ siteId: '12a' }).load!(ctx)
    expect(ctx.loadScript).not.toHaveBeenCalled()
  })

  it('sends the site’s own event names only when asked', async () => {
    const plugin = hotjar({ siteId: 1, events: 'custom' })
    const ctx = pluginContext(allowed)
    await plugin.load!(ctx)
    plugin.track!({ name: 'sign_up', params: {}, props: {} }, ctx)
    plugin.track!({ name: 'web_vital', params: {}, props: {} }, ctx)
    expect(window.hj!.q).toEqual([['event', 'sign_up']])
  })
})
