import { beforeEach, describe, expect, it, vi } from 'vitest'

import { consentState, makeConfig, settle } from '../../test/helpers'
import { resetLoadedResources } from './dom'
import { PluginHost } from './host'
import type { AnalyticsPlugin, ConsentState, PluginEvent, PluginSpec } from './types'
import { isCategoryAllowed, isPluginAllowed, pluginCategory } from './types'

const UNDECIDED_REQUIRED: ConsentState = consentState()
const GRANTED: ConsentState = consentState({ decision: true })
const DENIED: ConsentState = consentState({ decision: false })
const NOT_REQUIRED: ConsentState = consentState({ required: false })

const event = (name: string, params: Record<string, any> = {}): PluginEvent => ({
  name,
  params,
  props: params,
})

/** A fake plugin that records everything that happens to it. */
function recorder(name = 'fake', overrides: Partial<AnalyticsPlugin> = {}) {
  const log: string[] = []
  const plugin: AnalyticsPlugin = {
    name,
    load: () => {
      log.push('load')
    },
    consentChanged: state => {
      log.push(`consent:${state.allowed}`)
    },
    track: e => {
      log.push(`track:${e.name}`)
    },
    ...overrides,
  }
  const create = vi.fn(() => plugin)
  const spec: PluginSpec = {
    name,
    category: pluginCategory(plugin),
    cookies: plugin.cookies,
    storage: plugin.storage,
    withdrawal: plugin.withdrawal,
    create,
  }
  return { log, plugin, spec, create }
}

beforeEach(() => resetLoadedResources())

describe('isPluginAllowed / isCategoryAllowed', () => {
  const marketing = { category: 'marketing' as const }
  const statistics = { category: 'statistics' as const }

  it.each([
    ['undecided, consent required', UNDECIDED_REQUIRED, false],
    ['granted', GRANTED, true],
    ['denied', DENIED, false],
    ['consent not required', NOT_REQUIRED, true],
    ['consent not required but GPC', consentState({ required: false, gpc: true }), false],
    [
      'GPC but explicitly granted',
      consentState({ required: false, gpc: true, decision: true }),
      true,
    ],
    [
      'consent not required but explicitly denied',
      consentState({ required: false, decision: false }),
      false,
    ],
  ] as const)('marketing plugin: %s', (_label, state, expected) => {
    expect(isPluginAllowed(marketing, state)).toBe(expected)
  })

  it('Global Privacy Control withholds marketing only (it is an opt-out of sale/sharing)', () => {
    const gpc = consentState({ required: false, gpc: true })
    expect(isPluginAllowed(statistics, gpc)).toBe(true)
    expect(isCategoryAllowed('preferences', gpc)).toBe(true)
    expect(isPluginAllowed(marketing, gpc)).toBe(false)
  })

  it('follows the choice per category', () => {
    const statisticsOnly = consentState({ decision: { statistics: true } })
    expect(isPluginAllowed(statistics, statisticsOnly)).toBe(true)
    expect(isPluginAllowed(marketing, statisticsOnly)).toBe(false)
    expect(isCategoryAllowed('preferences', statisticsOnly)).toBe(false)
  })

  it('necessary (or requiresConsent: false) is always allowed; the default is marketing', () => {
    for (const state of [
      UNDECIDED_REQUIRED,
      DENIED,
      consentState({ required: false, gpc: true }),
    ]) {
      expect(isPluginAllowed({ category: 'necessary' }, state)).toBe(true)
      expect(isPluginAllowed({ requiresConsent: false }, state)).toBe(true)
    }
    expect(pluginCategory({})).toBe('marketing')
  })
})

describe('PluginHost', () => {
  it('does not create or load a plugin until it is allowed, then loads it once', async () => {
    const fake = recorder()
    const host = new PluginHost(makeConfig(), [fake.spec])

    host.applyConsent(UNDECIDED_REQUIRED)
    host.track(event('sign_up'))
    await settle()
    expect(fake.create).not.toHaveBeenCalled()

    host.applyConsent(GRANTED)
    host.applyConsent(GRANTED)
    await host.idle()
    host.applyConsent(NOT_REQUIRED)
    host.applyConsent(GRANTED)
    await host.idle()

    expect(fake.create).toHaveBeenCalledTimes(1)
    expect(fake.log.filter(entry => entry === 'load')).toHaveLength(1)
    expect(fake.log).not.toContain('track:sign_up') // sent before consent: never delivered
  })

  it('buffers events while loading and delivers them in order', async () => {
    let finishLoad = () => {}
    const fake = recorder('slow', {
      load: () => new Promise<void>(resolve => (finishLoad = resolve)),
    })
    const host = new PluginHost(makeConfig(), [fake.spec])

    host.applyConsent(GRANTED)
    host.track(event('a'))
    host.track(event('b'))
    await settle()
    expect(fake.log).toEqual([])

    finishLoad()
    await host.idle()
    host.track(event('c'))

    expect(fake.log).toEqual(['consent:true', 'track:a', 'track:b', 'track:c'])
  })

  it('announces the consent state after load, before any event', async () => {
    const fake = recorder()
    const host = new PluginHost(makeConfig(), [fake.spec])

    host.applyConsent(GRANTED)
    host.track(event('page_view'))
    await host.idle()

    expect(fake.log).toEqual(['load', 'consent:true', 'track:page_view'])
  })

  it('replays the current page view to a plugin that becomes allowed later', async () => {
    const fake = recorder()
    const host = new PluginHost(makeConfig(), [fake.spec])

    host.applyConsent(UNDECIDED_REQUIRED)
    host.track(event('page_view', { path: '/landing' }))
    host.track(event('web_vital'))
    host.applyConsent(GRANTED) // visitor accepts on the landing page
    await host.idle()

    expect(fake.log).toEqual(['load', 'consent:true', 'track:page_view'])
  })

  it('stops forwarding, announces and deletes vendor cookies when consent is withdrawn', async () => {
    document.cookie = '_vendor_id=1; Path=/'
    document.cookie = '_vendor_session=2; Path=/; Domain=.example.test'
    document.cookie = 'site_pref=keep; Path=/'
    const fake = recorder('vendor', { cookies: [/^_vendor/] })
    const host = new PluginHost(makeConfig(), [fake.spec])
    host.applyConsent(GRANTED)
    await host.idle()

    host.applyConsent(DENIED)
    host.track(event('sign_up'))

    expect(fake.log).toEqual(['load', 'consent:true', 'consent:false'])
    expect(document.cookie).toBe('site_pref=keep')
  })

  it('an explicit refusal deletes declared vendor data, even if the plugin never ran', () => {
    // Set on an earlier visit, or by a tag on the page.
    document.cookie = '_vendor_id=1; Path=/'
    localStorage.setItem('vendor.state', 'x')
    const fake = recorder('vendor', { cookies: [/^_vendor/], storage: ['vendor.*'] })
    const host = new PluginHost(makeConfig(), [fake.spec])

    host.applyConsent(UNDECIDED_REQUIRED)
    // Undecided is not a refusal: nothing is deleted yet.
    expect(document.cookie).toBe('_vendor_id=1')

    host.applyConsent(DENIED)
    expect(document.cookie).toBe('')
    expect(localStorage.getItem('vendor.state')).toBeNull()
    expect(fake.create).not.toHaveBeenCalled()
  })

  it('a stored refusal removes vendor data again on every page load', () => {
    document.cookie = '_vendor_id=1; Path=/'
    const fake = recorder('vendor', { cookies: [/^_vendor/] })
    // A new page: the first state the host sees is the stored refusal.
    new PluginHost(makeConfig(), [fake.spec]).applyConsent(DENIED)
    expect(document.cookie).toBe('')
  })

  it('keeps data of categories that are still allowed', () => {
    document.cookie = '_vendor_id=1; Path=/'
    const fake = recorder('vendor', { category: 'statistics', cookies: [/^_vendor/] })
    const host = new PluginHost(makeConfig(), [fake.spec])
    host.applyConsent(consentState({ decision: { statistics: true, marketing: false } }))
    expect(document.cookie).toBe('_vendor_id=1')
  })

  it('functional plugins run without consent and are told about consent changes', async () => {
    const fake = recorder('chat', { requiresConsent: false })
    const host = new PluginHost(makeConfig(), [fake.spec])

    host.applyConsent(UNDECIDED_REQUIRED)
    await host.idle()
    host.applyConsent(GRANTED)
    host.track(event('x'))

    expect(fake.log).toEqual(['load', 'consent:true', 'consent:true', 'track:x'])
    // (the state changed from undecided to granted; `allowed` stayed true)
  })

  it('a plugin that fails to load does not affect the others', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = recorder('broken', {
      load: () => {
        throw new Error('boom')
      },
    })
    const failingCreate: PluginSpec = {
      name: 'missing',
      category: 'marketing',
      create: () => Promise.reject(new Error('chunk failed')),
    }
    const good = recorder('good')
    const host = new PluginHost(makeConfig(), [broken.spec, failingCreate, good.spec])

    host.applyConsent(GRANTED)
    await host.idle()
    host.track(event('x'))

    expect(good.log).toEqual(['load', 'consent:true', 'track:x'])
    expect(host.status()).toMatchObject({
      broken: { status: 'failed' },
      missing: { status: 'failed' },
      good: { status: 'loaded' },
    })
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('exceptions in track or consentChanged are contained', async () => {
    const throwing = recorder('throwing', {
      track: () => {
        throw new Error('track failed')
      },
      consentChanged: () => {
        throw new Error('consent failed')
      },
    })
    const good = recorder('good')
    const host = new PluginHost(makeConfig(), [throwing.spec, good.spec])
    host.applyConsent(GRANTED)
    await host.idle()

    expect(() => host.track(event('x'))).not.toThrow()
    expect(good.log).toContain('track:x')
  })

  it('ignores a second plugin with the same name', () => {
    const a = recorder('same')
    const b = recorder('same')
    const host = new PluginHost(makeConfig(), [a.spec, b.spec])

    expect(host.pluginNames).toEqual(['same'])
  })
})

describe('PluginHost: bridges to page-installed tags (loadWithoutConsent)', () => {
  it('loads the bridge and announces "not allowed", but delivers no events until allowed', async () => {
    const fake = recorder('bridge')
    fake.spec.loadWithoutConsent = true
    const host = new PluginHost(makeConfig(), [fake.spec])

    host.applyConsent(UNDECIDED_REQUIRED)
    await host.idle()
    host.track(event('sign_up'))
    host.applyConsent(GRANTED)
    host.track(event('purchase'))

    expect(fake.log).toEqual(['load', 'consent:false', 'consent:true', 'track:purchase'])
  })
})

describe('PluginHost: replay on becoming allowed', () => {
  it('a bridge that was loaded before consent still receives the current page view on acceptance', async () => {
    const fake = recorder('bridge')
    fake.spec.loadWithoutConsent = true
    const host = new PluginHost(makeConfig(), [fake.spec])
    host.applyConsent(UNDECIDED_REQUIRED)
    await host.idle()
    host.track(event('page_view', { path: '/landing' }))

    host.applyConsent(GRANTED)
    host.applyConsent(DENIED)
    host.applyConsent(GRANTED) // replayed once per page, not on every change

    expect(fake.log).toEqual([
      'load',
      'consent:false',
      'consent:true',
      'track:page_view',
      'consent:false',
      'consent:true',
    ])
  })
})

describe('PluginHost: cookies per category', () => {
  it('withdrawing marketing deletes only the marketing cookies of a plugin', async () => {
    document.cookie = '_ga=1; Path=/'
    document.cookie = '_gcl_au=2; Path=/'
    const fake = recorder('google', {
      category: 'statistics',
      cookies: [
        { name: /^_ga/, category: 'statistics' },
        { name: /^_gcl_/, category: 'marketing' },
      ],
    })
    const host = new PluginHost(makeConfig(), [fake.spec])
    host.applyConsent(GRANTED)
    await host.idle()

    host.applyConsent(consentState({ decision: { statistics: true } }))

    expect(document.cookie).toBe('_ga=1')
    expect(host.status().google!.allowed).toBe(true)
  })
})

describe('PluginHost: withdrawal that needs a page reload', () => {
  const run = async (overrides: Partial<AnalyticsPlugin>, states: ConsentState[]) => {
    const fake = recorder('vendor', overrides)
    const host = new PluginHost(makeConfig(), [fake.spec])
    for (const state of states) {
      host.applyConsent(state)
      await host.idle()
    }
    return host
  }

  it('is requested when a running plugin that cannot be stopped is withdrawn', async () => {
    const host = await run({ withdrawal: 'reload' }, [GRANTED, DENIED])
    expect(host.takeReloadRequest()).toBe(true)
    // Reading the request clears it.
    expect(host.takeReloadRequest()).toBe(false)
  })

  it('is not requested for plugins that stop in place', async () => {
    expect((await run({ withdrawal: 'stop' }, [GRANTED, DENIED])).takeReloadRequest()).toBe(false)
  })

  it('is not requested if the plugin never ran (first decision is a refusal)', async () => {
    const host = await run({ withdrawal: 'reload' }, [UNDECIDED_REQUIRED, DENIED])
    expect(host.takeReloadRequest()).toBe(false)
  })

  it('is not requested when a different category is withdrawn', async () => {
    const host = await run({ withdrawal: 'reload', category: 'statistics' }, [
      GRANTED,
      consentState({ decision: { statistics: true, marketing: false } }),
    ])
    expect(host.takeReloadRequest()).toBe(false)
  })
})
