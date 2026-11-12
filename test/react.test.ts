// React integration (@clearideas/consent-analytics/react) and Next.js (@clearideas/consent-analytics/next).
import { createElement, StrictMode } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CONSENT_REQUIRED_GEO, FULL_TRACKING_GEO, mockApi, settle, TEST_API } from './helpers'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

// next/navigation is not installed; the Next.js component's hooks are driven by this state.
const navigation = vi.hoisted(() => ({ pathname: '/', search: '' }))
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const CONFIG = { apiBaseUrl: TEST_API, siteKey: 'test-site' }
const roots: Array<ReturnType<typeof createRoot>> = []

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()))
})

async function render(element: ReturnType<typeof createElement>) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(element))
  await act(async () => settle(40))
  return container
}

describe('AnalyticsProvider / useAnalytics / useConsent', () => {
  it('starts analytics on mount and exposes it to components', async () => {
    const api = mockApi({ geo: FULL_TRACKING_GEO })
    const { AnalyticsProvider, useAnalytics } = await import('../src/react')
    let seen: unknown = 'not rendered'
    const Probe = () => {
      seen = useAnalytics()
      return null
    }

    await render(createElement(AnalyticsProvider, { config: CONFIG }, createElement(Probe)))

    expect(seen).toMatchObject({ trackEvent: expect.any(Function), consent: expect.any(Object) })
    expect(await api.eventNames()).toContain('page_view')
  })

  it('useConsent re-renders when the policy is known and after a decision', async () => {
    mockApi({ geo: CONSENT_REQUIRED_GEO })
    const { AnalyticsProvider, useConsent } = await import('../src/react')
    const Status = () => {
      const consent = useConsent()
      return createElement(
        'output',
        null,
        consent ? `${consent.required}:${consent.granted}` : 'loading',
      )
    }

    const container = await render(
      createElement(AnalyticsProvider, { config: CONFIG }, createElement(Status)),
    )
    expect(container.textContent).toBe('true:null')

    await act(async () => document.getElementById('ci-consent-accept')!.click())
    expect(container.textContent).toBe('true:true')
  })

  it('useConsent updates when the policy arrives (it starts fail-closed: required)', async () => {
    mockApi({ geo: FULL_TRACKING_GEO })
    const { AnalyticsProvider, useConsent } = await import('../src/react')
    const Status = () => {
      const consent = useConsent()
      return createElement('output', null, consent ? `required=${consent.required}` : 'loading')
    }

    const container = await render(
      createElement(AnalyticsProvider, { config: CONFIG }, createElement(Status)),
    )

    expect(container.textContent).toBe('required=false')
  })

  it('useConsent re-renders when only a category changes', async () => {
    mockApi({ geo: CONSENT_REQUIRED_GEO })
    const { AnalyticsProvider, useAnalytics, useConsent } = await import('../src/react')
    let analytics: ReturnType<typeof useAnalytics> = null
    const Status = () => {
      analytics = useAnalytics()
      const consent = useConsent()
      return createElement(
        'output',
        null,
        consent ? `granted=${consent.granted} marketing=${consent.categories.marketing}` : '',
      )
    }
    const config = { ...CONFIG, consent: { choices: 'categories' as const } }
    const container = await render(
      createElement(AnalyticsProvider, { config }, createElement(Status)),
    )
    await act(async () => analytics!.consent.set({ statistics: true }))
    expect(container.textContent).toBe('granted=false marketing=false')

    // Still a partial choice (granted stays false); only a category changes.
    await act(async () => analytics!.consent.set({ statistics: true, marketing: true }))

    expect(container.textContent).toBe('granted=false marketing=true')
  })

  it('StrictMode (double effects) starts analytics once', async () => {
    const api = mockApi({ geo: FULL_TRACKING_GEO })
    const { AnalyticsProvider } = await import('../src/react')

    await render(
      createElement(StrictMode, null, createElement(AnalyticsProvider, { config: CONFIG })),
    )

    expect((await api.eventNames()).filter(name => name === 'page_view')).toHaveLength(1)
  })

  it('server rendering does nothing (no requests, hooks return null)', async () => {
    const api = mockApi({ geo: FULL_TRACKING_GEO })
    const { AnalyticsProvider, useAnalytics, useConsent } = await import('../src/react')
    const Probe = () =>
      createElement('span', null, `${useAnalytics() === null}:${useConsent() === null}`)

    const html = renderToString(
      createElement(AnalyticsProvider, { config: CONFIG }, createElement(Probe)),
    )
    await settle()

    expect(html).toContain('true:true')
    expect(api.requests).toEqual([])
  })
})

describe('Next.js <ClearIdeasAnalytics>', () => {
  it('reports App Router navigations (path and query) as page views', async () => {
    navigation.pathname = '/'
    navigation.search = ''
    const api = mockApi({ geo: FULL_TRACKING_GEO })
    const { ClearIdeasAnalytics } = await import('../src/next')
    const app = () => createElement(ClearIdeasAnalytics, { config: CONFIG }, createElement('main'))
    const container = await render(app())
    const root = roots[roots.length - 1]!

    const navigate = async (path: string, search = '') => {
      // The App Router updates the URL and its hooks; the component reports the change.
      window.history.pushState(null, '', `${path}${search ? `?${search}` : ''}`)
      navigation.pathname = path
      navigation.search = search
      await act(async () => root.render(app()))
      await act(async () => settle())
    }
    await navigate('/pricing')
    await navigate('/pricing', 'plan=pro')
    await navigate('/pricing', 'plan=pro') // re-render without navigation

    const analytics = (await import('../src/browser')).getBrowserAnalytics()!
    await analytics.flush()
    const views = (await api.events()).filter(e => e.name === 'page_view').map(e => e.props.url)
    expect(views).toEqual([
      'https://www.example.test/',
      'https://www.example.test/pricing',
      'https://www.example.test/pricing', // query changed; the query itself is not sent
    ])
    expect(container.querySelector('main')).not.toBeNull()
  })

  it('is a client module and re-exports the hooks', async () => {
    const next = await import('../src/next')
    expect(typeof next.useAnalytics).toBe('function')
    expect(typeof next.useConsent).toBe('function')
  })
})
