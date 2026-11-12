import { beforeEach, describe, expect, it, vi } from 'vitest'

import { consentState, makeConfig, pluginState } from '../../test/helpers'
import { resetLoadedResources } from './dom'
import { openAIAds } from './openai-ads'
import type { PluginContext } from './types'

function context(): PluginContext {
  return {
    config: makeConfig(),
    consent: () => pluginState(consentState({ decision: true })),
    debug: () => {},
    loadScript: vi.fn(async () => {}),
    loadStylesheet: vi.fn(async () => {}),
  }
}

beforeEach(() => {
  resetLoadedResources()
  delete window.oaiq
})

describe('openAIAds plugin', () => {
  it('initializes the pixel and queues the mapped event', () => {
    const plugin = openAIAds({ pixelId: 'px_test' })
    const ctx = context()

    plugin.load!(ctx)
    plugin.track!({ name: 'trial_started', params: {}, props: { plan_id: 'demo_trial' } }, ctx)

    expect(ctx.loadScript).toHaveBeenCalledWith('https://bzrcdn.openai.com/sdk/oaiq.min.js')
    expect((window.oaiq as any).q).toEqual([
      ['init', { pixelId: 'px_test', debug: false }],
      ['measure', 'trial_started', { type: 'plan_enrollment', plan_id: 'free_trial' }],
    ])
  })

  it('ignores events without a mapping and custom events without a name', () => {
    const plugin = openAIAds({
      pixelId: 'px_test',
      events: { my_event: { eventName: 'custom', type: 'custom' } },
    })
    plugin.load!(context())

    plugin.track!({ name: 'unmapped_event', params: {}, props: {} }, context())
    plugin.track!({ name: 'my_event', params: {}, props: {} }, context())

    expect((window.oaiq as any).q).toEqual([['init', { pixelId: 'px_test', debug: false }]])
  })

  it('supports per-event overrides and page contents', () => {
    const plugin = openAIAds({ pixelId: 'px_test', events: { pricing: 'page_viewed' } })
    plugin.load!(context())

    plugin.track!(
      { name: 'pricing', params: {}, props: { path: '/pricing', pageTitle: 'Pricing' } },
      context(),
    )

    expect((window.oaiq as any).q[1]).toEqual([
      'measure',
      'page_viewed',
      { type: 'contents', contents: [{ id: '/pricing', name: 'Pricing', content_type: 'page' }] },
    ])
  })
})
