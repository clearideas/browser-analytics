import { describe, expect, it, vi } from 'vitest'

import { pluginContext, pluginStates } from '../../test/helpers'
import { linkedInInsight } from './linkedin-insight'

const { allowed } = pluginStates()

describe('linkedInInsight plugin', () => {
  it('registers the partner ID and loads the Insight Tag', async () => {
    const ctx = pluginContext(allowed)
    await linkedInInsight({ partnerId: 98765 }).load!(ctx)
    expect(window._linkedin_partner_id).toBe('98765')
    expect(window._linkedin_data_partner_ids).toEqual(['98765'])
    expect(ctx.loadScript).toHaveBeenCalledWith(
      'https://snap.licdn.com/li.lms-analytics/insight.min.js',
    )
  })

  it('cannot be stopped once running: withdrawal reloads the page', () => {
    const plugin = linkedInInsight({ partnerId: 1 })
    expect(plugin.withdrawal).toBe('reload')
    expect(plugin.consentChanged).toBeUndefined()
  })

  it('refuses an invalid partner ID', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ctx = pluginContext(allowed)
    await linkedInInsight({ partnerId: 'x' }).load!(ctx)
    expect(ctx.loadScript).not.toHaveBeenCalled()
  })

  it('sends mapped conversions only', async () => {
    const plugin = linkedInInsight({ partnerId: 1, conversions: { sign_up: '555' } })
    const ctx = pluginContext(allowed)
    await plugin.load!(ctx)
    plugin.track!({ name: 'sign_up', params: {}, props: {} }, ctx)
    plugin.track!({ name: 'page_view', params: {}, props: {} }, ctx)
    expect(window.lintrk!.q).toEqual([['track', { conversion_id: 555 }]])
  })
})
