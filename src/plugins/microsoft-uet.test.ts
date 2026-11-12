import { beforeEach, describe, expect, it, vi } from 'vitest'

import { consentState, makeConfig, pluginState } from '../../test/helpers'
import { resetLoadedResources } from './dom'
import { microsoftUet } from './microsoft-uet'
import type { PluginConsentState, PluginContext } from './types'

const ALLOWED: PluginConsentState = pluginState(consentState({ decision: true }))
const DENIED: PluginConsentState = pluginState(consentState({ decision: false }))

function context(state = ALLOWED): PluginContext {
  return {
    config: makeConfig(),
    consent: () => state,
    debug: () => {},
    loadScript: vi.fn(async () => {}),
    loadStylesheet: vi.fn(async () => {}),
  }
}

beforeEach(() => {
  resetLoadedResources()
  delete window.uetq
  delete window.UET
})

describe('microsoftUet plugin (loads bat.js)', () => {
  it('queues consent, loads bat.js and bootstraps the tag with the queue', async () => {
    const created: any[] = []
    window.UET = class {
      pushed: unknown[][] = []
      constructor(public options: any) {
        created.push(this)
      }
      push(...args: unknown[]) {
        this.pushed.push(args)
      }
    } as any
    const ctx = context()

    microsoftUet({ tagId: '12345' }).load!(ctx)
    const queued = [...(window.uetq as unknown[])]
    await Promise.resolve()
    await Promise.resolve()

    expect(queued).toEqual([
      'consent',
      'default',
      { ad_storage: 'denied' },
      'consent',
      'update',
      { ad_storage: 'granted' },
    ])
    expect(ctx.loadScript).toHaveBeenCalledWith('https://bat.bing.com/bat.js')
    expect(created[0].options).toMatchObject({ ti: '12345' })
    expect(created[0].pushed).toEqual([['pageLoad']])
  })

  it('requires a tag ID', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ctx = context()
    microsoftUet({}).load!(ctx)
    expect(ctx.loadScript).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('tagId'))
  })
})

describe('microsoftUet plugin (page-installed uetq)', () => {
  it('updates consent and sends pageLoad once when granted', () => {
    const uetq: unknown[][] = []
    window.uetq = { push: (...args: unknown[]) => uetq.push(args) }
    const plugin = microsoftUet({ loadScript: false })

    plugin.load!(context())
    plugin.consentChanged!(ALLOWED, context())
    plugin.consentChanged!(DENIED, context())
    plugin.consentChanged!(ALLOWED, context())

    expect(uetq).toEqual([
      ['consent', 'update', { ad_storage: 'granted' }],
      ['pageLoad'],
      ['consent', 'update', { ad_storage: 'denied' }],
      ['consent', 'update', { ad_storage: 'granted' }],
    ])
  })
})

describe('microsoftUet events and conversions', () => {
  const setup = (options = {}) => {
    const uetq: unknown[][] = []
    window.uetq = { push: (...args: unknown[]) => uetq.push(args) }
    return {
      uetq,
      plugin: microsoftUet({ loadScript: false, goals: { purchase: 'G-1' }, ...options }),
    }
  }

  it('fires a goal conversion for Microsoft Ads traffic, with revenue', () => {
    const { uetq, plugin } = setup()
    plugin.track!(
      {
        name: 'purchase',
        params: {},
        props: { value: 99, currency: 'EUR' },
        attribution: { msclkid: 'm' },
      },
      context(),
    )
    expect(uetq).toEqual([['event', 'conversion', { gv: 'G-1', rv: 99, rc: 'EUR' }]])
  })

  it('sends a plain event when a goal exists but the traffic is not from Microsoft Ads', () => {
    const { uetq, plugin } = setup()
    plugin.track!({ name: 'purchase', params: {}, props: { value: 99 } }, context())
    expect(uetq).toEqual([['event', { ec: 'Custom', ea: 'purchase', el: 'general', ev: 99 }]])
  })

  it('maps well-known events and skips automatic ones by default', () => {
    const { uetq, plugin } = setup()
    plugin.track!({ name: 'sign_up', params: {}, props: { method: 'email' } }, context())
    plugin.track!({ name: 'web_vital', params: {}, props: {} }, context())
    plugin.track!({ name: 'page_view', params: {}, props: {} }, context())
    expect(uetq).toEqual([['event', { ec: 'Custom', ea: 'signup', el: 'email' }]])
  })

  it('forwards automatic events with events: "all"', () => {
    const { uetq, plugin } = setup({ events: 'all' })
    plugin.track!({ name: 'web_vital', params: {}, props: {} }, context())
    expect(uetq).toHaveLength(1)
  })
})
