// Framework-agnostic integration (@clearideas/consent-analytics/browser).
import { describe, expect, it } from 'vitest'

import { CONSENT_REQUIRED_GEO, FULL_TRACKING_GEO, mockApi, settle, TEST_API } from './helpers'

const OPTIONS = { apiBaseUrl: TEST_API, siteKey: 'test-site' }

async function start(routeChanges?: 'history' | 'manual', geo: any = FULL_TRACKING_GEO) {
  const api = mockApi({ geo })
  const browser = await import('../src/browser')
  const analytics = browser.initBrowserAnalytics(OPTIONS, { routeChanges })
  await settle(40)
  const pageViews = async () => {
    await analytics.flush()
    return (await api.events()).filter(e => e.name === 'page_view').map(e => e.props.path)
  }
  return { api, browser, analytics, pageViews }
}

describe('initBrowserAnalytics', () => {
  it('needs only apiBaseUrl and siteKey', async () => {
    const { pageViews, api } = await start()

    expect(await pageViews()).toEqual(['/'])
    expect(api.requests[0]!.url).toContain('siteKey=test-site')
  })

  it('returns the running instance when called again (StrictMode, hot reload)', async () => {
    const { browser, analytics, pageViews } = await start()

    expect(browser.initBrowserAnalytics(OPTIONS)).toBe(analytics)
    expect(browser.getBrowserAnalytics()).toBe(analytics)
    await settle(40)
    expect(await pageViews()).toEqual(['/'])
  })
})

describe('page changes from the History API', () => {
  it('pushState and back/forward (popstate) are page views', async () => {
    const { pageViews } = await start()

    window.history.pushState({}, '', '/pricing')
    await settle()
    window.history.pushState({}, '', '/docs?tab=api')
    await settle()
    // Back button: the browser changes the URL itself (no pushState), then fires popstate.
    // (history.back() is asynchronous in the test DOM and would leak into later tests.)
    History.prototype.replaceState.call(window.history, {}, '', '/pricing')
    window.dispatchEvent(new PopStateEvent('popstate'))
    await settle()

    expect(await pageViews()).toEqual(['/', '/pricing', '/docs', '/pricing'])
  })

  it('replaceState to the same page, in-page anchors and bursts are not extra page views', async () => {
    const { pageViews } = await start()

    window.history.replaceState({ scroll: 100 }, '', '/') // scroll restoration
    window.history.pushState({}, '', '/#section') // in-page anchor
    await settle()
    window.history.pushState({}, '', '/pricing') // router: push then replace in one tick
    window.history.replaceState({ key: 'x' }, '', '/pricing')
    await settle()

    expect(await pageViews()).toEqual(['/', '/pricing'])
  })

  it('removing attribution parameters after consent is not a page view', async () => {
    window.history.replaceState(null, '', '/landing?utm_source=google&gclid=abc')
    const { pageViews } = await start('history', CONSENT_REQUIRED_GEO)

    document.getElementById('ci-consent-accept')!.click()
    await settle()

    expect(window.location.search).toBe('')
    expect(await pageViews()).toEqual(['/landing'])
  })

  it('keeps calling the original history methods', async () => {
    await start()
    window.history.pushState({ marker: 1 }, '', '/kept')

    expect(window.location.pathname).toBe('/kept')
    expect(window.history.state).toEqual({ marker: 1 })
  })
})

describe("routeChanges: 'manual'", () => {
  it('ignores the History API and tracks notifyRouteChange() calls', async () => {
    const { analytics, pageViews } = await start('manual')

    window.history.pushState({}, '', '/not-reported')
    await settle()
    window.history.pushState({}, '', '/reported')
    analytics.notifyRouteChange()
    analytics.notifyRouteChange() // same page again: ignored
    await settle()

    expect(await pageViews()).toEqual(['/', '/reported'])
  })
})

describe('watchHistory', () => {
  it('reports path changes until unsubscribed', async () => {
    const { watchHistory } = await import('../src/browser')
    const seen: string[] = []
    const stop = watchHistory(path => seen.push(path))

    window.history.pushState({}, '', '/a')
    await settle()
    stop()
    window.history.pushState({}, '', '/b')
    await settle()

    expect(seen).toEqual(['/a'])
  })
})
