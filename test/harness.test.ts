// Guards the test harness itself: later suites depend on isolation between tests.
import { describe, expect, it } from 'vitest'

import { makeAdapter, mockApi, settle } from './helpers'

describe('test harness', () => {
  let leakedClicks = 0

  it('step 1: registers a document listener and writes storage/cookies', () => {
    document.addEventListener('click', () => leakedClicks++)
    localStorage.setItem('k', 'v')
    sessionStorage.setItem('k', 'v')
    document.cookie = 'c=1; Path=/'
    document.cookie = 'd=1; Path=/; Domain=.example.test'
    document.cookie = 'e=1; Path=/; Domain=example.test'
    window.history.replaceState(null, '', '/somewhere?x=1')
    ;(window as any).gtag = () => {}
  })

  it('step 2: previous listeners, storage, cookies, URL and vendor globals are gone', () => {
    document.body.click()
    expect(leakedClicks).toBe(0)
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    expect(document.cookie).toBe('')
    expect(window.location.pathname + window.location.search).toBe('/')
    expect((window as any).gtag).toBeUndefined()
  })

  let leakedTimeout = false
  it('step 3: schedules a timeout and ends without waiting for it', () => {
    setTimeout(() => (leakedTimeout = true), 0)
  })

  it('step 4: timeouts from previous tests never fire', async () => {
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(leakedTimeout).toBe(false)
  })

  it('blocks unmocked network access', async () => {
    await expect(fetch('https://example.com/')).rejects.toThrow(/Unmocked fetch/)
  })

  it('records fetch requests with parsed JSON bodies', async () => {
    const api = mockApi({ beacon: 'unavailable' })

    await fetch('https://api.example.test/v1/events', {
      method: 'POST',
      body: JSON.stringify({ v: 1, events: [{ name: 'x' }] }),
    })

    expect(api.requests[0]).toMatchObject({
      transport: 'fetch',
      method: 'POST',
      path: '/v1/events',
    })
    expect(await api.eventNames()).toEqual(['x'])
  })

  it('records sendBeacon requests with decoded Blob bodies', async () => {
    const api = mockApi({ beacon: 'available' })
    const blob = new Blob([JSON.stringify({ v: 1, events: [{ name: 'y' }] })], {
      type: 'text/plain',
    })

    expect(navigator.sendBeacon('https://api.example.test/v1/events', blob)).toBe(true)

    expect(await api.eventNames()).toEqual(['y'])
  })

  it('serves the configured context response', async () => {
    mockApi({ geo: { country: 'US', continent: 'NA', requiresConsent: false } })

    const context = await (await fetch('https://api.example.test/v1/context?siteKey=x')).json()

    expect(context).toMatchObject({
      policy: { consentRequired: false, policyVersion: '1' },
      geo: { country: 'US', continent: 'NA' },
    })
  })

  it('adapter.navigate updates the URL and notifies route listeners', async () => {
    const { adapter, navigate } = makeAdapter()
    const seen: string[] = []
    adapter.onRouteChange(path => seen.push(path))

    navigate('/pricing')
    await settle(1)

    expect(window.location.pathname).toBe('/pricing')
    expect(seen).toEqual(['/pricing'])
  })
})
