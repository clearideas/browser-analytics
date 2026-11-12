// Automatic tracking paths: outbound links, scroll depth, interaction counts, web vitals,
// and the opt-in console helpers.
import { describe, expect, it, vi } from 'vitest'

import { boot, setPageHidden, settle } from './helpers'

type Session = Awaited<ReturnType<typeof boot>>

async function flushed(session: Session) {
  await session.analytics.flush()
  return session.api.events()
}

describe('outbound links', () => {
  it('records clicks on links to other origins, without query or fragment', async () => {
    const session = await boot({ config: { autoTrackOutboundLinks: true } })
    document.body.innerHTML = `
      <a id="out" href="https://partner.example/offer?ref=SECRET#x"><span>See <b>offer</b></span></a>
      <a id="same" href="/pricing">Pricing</a>
      <a id="js" href="javascript:void(0)">JS</a>
      <a id="hash" href="#top">Top</a>`

    for (const id of ['out', 'same', 'js', 'hash']) {
      const target = id === 'out' ? document.querySelector('#out b')! : document.getElementById(id)!
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    }
    await settle()

    const clicks = (await flushed(session)).filter(e => e.name === 'outbound_link_click')
    expect(clicks).toHaveLength(1)
    expect(clicks[0]!.props).toMatchObject({
      outboundUrl: 'https://partner.example/offer',
      outboundHost: 'partner.example',
      outboundPath: '/offer',
      outboundText: 'See offer',
    })
    expect(JSON.stringify(clicks)).not.toContain('SECRET')
  })
})

describe('scroll depth', () => {
  it('records each new maximum of at least 25%', async () => {
    const session = await boot({ config: { autoTrackScrollDepth: true } })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    Object.defineProperty(document.body, 'scrollHeight', { value: 4000, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true })

    const scrollTo = (y: number) => {
      Object.defineProperty(window, 'pageYOffset', { value: y, configurable: true })
      window.dispatchEvent(new Event('scroll'))
      vi.advanceTimersByTime(300)
    }
    scrollTo(0) // 25%
    scrollTo(1000) // 50%
    scrollTo(500) // lower: ignored
    scrollTo(3000) // 100%
    vi.useRealTimers()
    await settle()

    const depths = (await flushed(session))
      .filter(e => e.name === 'scroll_depth')
      .map(e => e.props.depth)
    expect(depths).toEqual([25, 50, 100])
  })
})

describe('interaction counts', () => {
  it('page_exit reports clicks and keypresses (ignoring shortcuts) for the page', async () => {
    const session = await boot({ beacon: 'available' })
    document.body.click()
    document.body.click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }))

    setPageHidden(true)

    const exit = (await session.api.events()).find(e => e.name === 'page_exit')!
    expect(exit.props).toMatchObject({ clicks: 2, keypresses: 1 })
  })
})

describe('web vitals', () => {
  it('reports LCP, FID, FCP, TTFB as observed and CLS when the page is hidden', async () => {
    const observers = new Map<string, (list: { getEntries: () => any[] }) => void>()
    vi.stubGlobal(
      'PerformanceObserver',
      class {
        constructor(private callback: (list: { getEntries: () => any[] }) => void) {}
        observe({ entryTypes }: { entryTypes: string[] }) {
          for (const type of entryTypes) observers.set(type, this.callback)
        }
        disconnect() {}
      },
    )
    const session = await boot({ beacon: 'available' })
    const emit = (type: string, entries: any[]) =>
      observers.get(type)!({ getEntries: () => entries })

    emit('largest-contentful-paint', [{ startTime: 800.4 }, { startTime: 1234.6 }])
    emit('first-input', [{ startTime: 100, processingStart: 112.4 }])
    emit('paint', [{ startTime: 456.7 }])
    emit('navigation', [{ requestStart: 10, responseStart: 75.2 }])
    emit('layout-shift', [
      { value: 0.05, hadRecentInput: false },
      { value: 0.5, hadRecentInput: true },
      { value: 0.0123, hadRecentInput: false },
    ])
    await settle()
    setPageHidden(true)
    await session.analytics.flush()

    const vitals = Object.fromEntries(
      (await session.api.events())
        .filter(e => e.name === 'web_vital')
        .map(e => [e.props.name, e.props.value]),
    )
    expect(vitals).toEqual({ LCP: 1235, FID: 12, FCP: 457, TTFB: 65, CLS: 0.062 })
  })
})

describe('console helpers (exposeGlobals)', () => {
  it('toggle debug logging and report owner-tracking status', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await boot({ config: { exposeGlobals: true } })
    const ns = (window as any).ciAnalytics

    expect(ns.enableDebug()).toEqual({ enabled: true, source: 'console override' })
    expect(ns.debugStatus().enabled).toBe(true)
    expect(ns.disableDebug()).toEqual({ enabled: false, source: 'console override' })
    expect(ns.ownerTrackingStatus()).toMatchObject({ enabled: false })
    expect(log).toHaveBeenCalled()
  })

  it('opening the banner from the console works', async () => {
    await boot({ config: { exposeGlobals: true } })

    ;(window as any).ciAnalytics.showCookieBanner()

    expect(document.getElementById('ci-consent-banner')).not.toBeNull()
  })
})
