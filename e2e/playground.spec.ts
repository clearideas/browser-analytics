// A real browser drives the playground against the sample collector. Each test starts
// with a fresh browser profile and a reset collector.
import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

const API = 'http://localhost:18787'

interface StoredEvent {
  name: string
  trackingCategory: 'full' | 'limited'
  consentRequired: boolean
  consentGranted: boolean
  props: Record<string, any>
  origin: string
}

const events = async (request: APIRequestContext): Promise<StoredEvent[]> =>
  (await request.get(`${API}/_dev/events`)).json()
const consents = async (request: APIRequestContext) =>
  (await request.get(`${API}/_dev/consents`)).json()
const names = async (request: APIRequestContext) => (await events(request)).map(e => e.name)
const gtagCalls = (page: Page) => page.evaluate(() => (window as any).dataLayer as unknown[][])

async function visitFrom(request: APIRequestContext, country: string | null) {
  await request.post(`${API}/_dev/geo`, { data: { country } })
}

const pageErrors: string[] = []

test.beforeEach(async ({ request, page }) => {
  await request.post(`${API}/_dev/reset`)
  pageErrors.length = 0
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error') pageErrors.push(message.text())
  })
})

test.afterEach(() => {
  expect(pageErrors, 'no errors in the page').toEqual([])
})

test('EU visitor: banner, and only limited anonymous events before a decision', async ({
  page,
  request,
}) => {
  await visitFrom(request, 'DE')
  await page.goto('/pricing?utm_source=newsletter&gclid=CLICK-1')

  await expect(page.locator('#ci-consent-banner')).toBeVisible()
  await expect.poll(() => names(request)).toContain('page_view')

  await page.click('#ev-signup') // non-essential: must not be sent without consent
  await page.click('#flush')
  await page.waitForTimeout(300)

  const stored = await events(request)
  expect(stored.map(e => e.name)).not.toContain('sign_up')
  expect(stored.every(e => e.trackingCategory === 'limited')).toBe(true)
  const pageView = stored.find(e => e.name === 'page_view')!
  expect(pageView.props.url).toBe('http://localhost:15173/pricing')
  expect(JSON.stringify(stored)).not.toContain('CLICK-1')
  expect(await page.evaluate(() => localStorage.getItem('ci_click'))).toBeNull()
  expect((await gtagCalls(page)).filter(call => call[0] === 'event')).toEqual([])
})

test('EU visitor from an ad accepts: consent record, attribution, full events, conversion', async ({
  page,
  request,
}) => {
  await visitFrom(request, 'DE')
  await page.goto('/pricing?gclid=PLAYGROUND-GCLID-123&utm_source=google&utm_medium=cpc')

  await page.click('#ci-consent-accept')
  await expect(page.locator('#ci-consent-banner')).toHaveCount(0)
  await expect
    .poll(() => consents(request))
    .toEqual([
      expect.objectContaining({ decision: 'granted', policyVersion: '1', source: 'banner' }),
    ])
  await expect(page).toHaveURL('http://localhost:15173/pricing') // attribution params removed

  const attribution = JSON.parse((await page.evaluate(() => localStorage.getItem('ci_click')))!)
  expect(attribution).toMatchObject({
    gclid: 'PLAYGROUND-GCLID-123',
    utm_source: 'google',
    landingPath: '/pricing',
  })

  await page.click('#ev-signup')
  await expect.poll(() => names(request)).toContain('sign_up')
  const signUp = (await events(request)).find(e => e.name === 'sign_up')!
  expect(signUp).toMatchObject({
    trackingCategory: 'full',
    consentRequired: true,
    consentGranted: true,
  })
  expect(signUp.props.attribution).toMatchObject({ gclid: 'PLAYGROUND-GCLID-123' })

  const calls = await gtagCalls(page)
  expect(calls).toContainEqual([
    'consent',
    'update',
    expect.objectContaining({ ad_storage: 'granted' }),
  ])
  // The page where the visitor accepted is recorded by Google too (replayed on acceptance).
  expect(calls).toContainEqual([
    'event',
    'page_view',
    expect.objectContaining({ page_path: '/pricing' }),
  ])
  const gaSignUp = calls.find(call => call[0] === 'event' && call[1] === 'sign_up')!
  expect(gaSignUp[2]).toEqual({ plan: 'pro', method: 'email' }) // no attribution or click IDs
  expect(calls).toContainEqual([
    'event',
    'conversion',
    { send_to: 'AW-PLAYGROUND/signup', transport_type: 'beacon' },
  ])
})

test('EU visitor rejects: denied record, no attribution, trackers denied', async ({
  page,
  request,
}) => {
  await visitFrom(request, 'FR')
  await page.goto('/?utm_source=google&gclid=X1')

  await page.click('#ci-consent-reject')
  await expect
    .poll(() => consents(request))
    .toEqual([expect.objectContaining({ decision: 'denied' })])

  await page.click('#ev-signup')
  await page.click('#flush')
  await page.waitForTimeout(300)
  expect(await names(request)).not.toContain('sign_up')
  expect(await page.evaluate(() => localStorage.getItem('ci_click'))).toBeNull()
  expect(await gtagCalls(page)).toContainEqual([
    'consent',
    'update',
    expect.objectContaining({ ad_storage: 'denied' }),
  ])
})

test('changing your mind: Manage cookies → reject records a withdrawal with the same consent ID', async ({
  page,
  request,
}) => {
  await visitFrom(request, 'DE')
  await page.goto('/')
  await page.click('#ci-consent-accept')
  await page.click('#manage-cookies')
  await page.click('#ci-consent-reject')

  await expect
    .poll(async () => (await consents(request)).map((c: any) => c.decision))
    .toEqual(['granted', 'denied'])
  const [granted, denied] = await consents(request)
  expect(denied.consentId).toBe(granted.consentId)
})

test('US visitor: no banner, full tracking, attribution captured, URL cleaned', async ({
  page,
  request,
}) => {
  await visitFrom(request, 'US')
  await page.goto('/pricing?utm_source=google&utm_medium=cpc&gclid=US-1')

  await expect.poll(() => names(request)).toContain('page_view')
  await expect(page.locator('#ci-consent-banner')).toHaveCount(0)
  await expect(page).toHaveURL('http://localhost:15173/pricing')
  const pageView = (await events(request)).find(e => e.name === 'page_view')!
  expect(pageView).toMatchObject({ trackingCategory: 'full', consentRequired: false })
  expect(pageView.props.attribution).toMatchObject({ gclid: 'US-1', utm_source: 'google' })
})

test('unknown region: consent is required (fail closed)', async ({ page, request }) => {
  await visitFrom(request, null)
  await page.goto('/')

  await expect(page.locator('#ci-consent-banner')).toBeVisible()
})

test('secrets in the landing URL never leave the browser', async ({ page, request }) => {
  await visitFrom(request, 'US')
  await page.goto(
    '/reset-password?token=SECRET-RESET-TOKEN&email=jane%40example.com#access_token=SECRET-FRAGMENT',
  )
  await expect.poll(() => names(request)).toContain('page_view')
  await page.click('a[href="/docs"]')
  await expect.poll(() => names(request)).toContain('page_exit')

  const everything = JSON.stringify({ events: await events(request), gtag: await gtagCalls(page) })
  for (const secret of ['SECRET-RESET-TOKEN', 'jane', 'SECRET-FRAGMENT'])
    expect(everything).not.toContain(secret)
  const pageView = (await events(request)).find(e => e.name === 'page_view')!
  expect(pageView.props.url).toBe('http://localhost:15173/reset-password')
})

test('single-page navigation: one page_view per route, page_exit describes the page left', async ({
  page,
  request,
}) => {
  await visitFrom(request, 'US')
  await page.goto('/')
  await expect.poll(() => names(request)).toContain('page_view')

  await page.click('a[href="/pricing"]')
  await page.click('a[href="/docs"]')
  await expect
    .poll(async () =>
      (await events(request)).filter(e => e.name === 'page_view').map(e => e.props.path),
    )
    .toEqual(['/', '/pricing', '/docs'])
  const exits = (await events(request)).filter(e => e.name === 'page_exit').map(e => e.props.path)
  expect(exits).toEqual(['/', '/pricing'])
})

test('leaving the page delivers page_exit via sendBeacon (real unload)', async ({
  page,
  request,
}) => {
  await visitFrom(request, 'US')
  await page.goto('/pricing')
  await expect.poll(() => names(request)).toContain('page_view')

  await page.goto('about:blank') // pagehide → sendBeacon

  await expect.poll(() => names(request)).toContain('page_exit')
  const exit = (await events(request)).find(e => e.name === 'page_exit')!
  expect(exit.props.path).toBe('/pricing')
  expect(exit.origin).toBe('http://localhost:15173') // Origin header present on the beacon
})

test('a new policy version asks a visitor who already consented again', async ({
  page,
  request,
}) => {
  await visitFrom(request, 'DE')
  await page.goto('/')
  await page.click('#ci-consent-accept')
  await page.reload()
  await expect(page.locator('#ci-consent-banner')).toHaveCount(0)

  await page.click('#new-policy') // publishes a new version and reloads

  await expect(page.locator('#ci-consent-banner')).toBeVisible()
})

test('custom event names are normalized to the contract', async ({ page, request }) => {
  await visitFrom(request, 'US')
  await page.goto('/')
  await page.click('#ev-custom') // "Newsletter Signup"

  await expect.poll(() => names(request)).toContain('newsletter_signup')
})

test('the collector rejects other origins (CORS)', async ({ page, request }) => {
  await visitFrom(request, 'US')
  await page.goto('/')

  // From the page, a request to the collector works...
  const ok = await page.evaluate(
    async api => (await fetch(`${api}/v1/context?siteKey=demo-site`)).status,
    API,
  )
  expect(ok).toBe(200)
  // ...and a forged origin is refused.
  const forged = await request.post(`${API}/v1/events`, {
    headers: { Origin: 'https://evil.example', 'Content-Type': 'text/plain' },
    data: JSON.stringify({
      v: 1,
      siteKey: 'demo-site',
      sentAt: new Date().toISOString(),
      events: [],
    }),
  })
  expect(forged.status()).toBe(403)
})

test('playground: "Reset consent" forgets the decision; "Reset everything" starts over', async ({
  page,
  request,
}) => {
  await visitFrom(request, 'DE')
  await page.goto('/')
  await page.click('#ci-consent-accept')
  await expect.poll(() => consents(request)).toHaveLength(1)

  await page.click('#reset-consent')
  await expect(page.locator('#ci-consent-banner')).toBeVisible()
  await expect(page.locator('#reset-note')).toContainText('Consent reset')
  expect(await page.evaluate(() => localStorage.getItem('ci_consent_status'))).toBeNull()

  await page.click('#reset-all')
  await expect(page.locator('#reset-note')).toContainText('Everything reset')
  await expect.poll(() => consents(request)).toEqual([])
  // Region override cleared: unknown region, so consent is required again.
  await expect(page.locator('#ci-consent-banner')).toBeVisible()
  await expect
    .poll(async () => (await events(request)).every(e => e.trackingCategory === 'limited'))
    .toBe(true)
})

test('the banner is accessible: named region, named buttons, keyboard operable', async ({
  page,
  request,
}) => {
  await visitFrom(request, 'DE')
  await page.goto('/')

  const region = page.getByRole('region', { name: 'Help us improve your experience' })
  await expect(region).toBeVisible()
  await expect(region.getByRole('button', { name: 'Accept all' })).toBeVisible()
  await expect(region.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute(
    'href',
    'http://localhost:15173/privacy',
  )

  await region.getByRole('button', { name: 'Reject non-essential' }).focus()
  await page.keyboard.press('Enter')

  await expect(region).toHaveCount(0)
  await expect
    .poll(() => consents(request))
    .toEqual([expect.objectContaining({ decision: 'denied' })])
})

test('the library\'s "Cookie settings" button reopens the banner with focus', async ({
  page,
  request,
}) => {
  await visitFrom(request, 'DE')
  await page.goto('/')
  await page.click('#ci-consent-accept')

  const settings = page.locator('#ci-consent-manage')
  await expect(settings).toBeVisible()
  await settings.click()

  await expect(page.locator('#ci-consent-banner')).toBeVisible()
  await expect(settings).toBeHidden()
  await expect(page.locator('#ci-consent-reject')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect
    .poll(async () => (await consents(request)).map((c: any) => c.decision))
    .toEqual(['granted', 'denied'])
  await expect(settings).toBeFocused() // focus returns to where the visitor started
})

test('Global Privacy Control: marketing withheld outside consent regions; analytics unaffected', async ({
  page,
  request,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: true }),
  )
  await visitFrom(request, 'US')
  await page.goto('/?gclid=G-ADS&utm_source=google')
  await page.click('#ev-signup')
  await page.click('#flush')

  await expect.poll(() => names(request)).toContain('sign_up')
  expect((await events(request)).every(e => e.trackingCategory === 'full')).toBe(true)
  await expect(page.locator('#status')).toContainText('GPC: on')
  await expect(page.locator('#status')).toContainText('Marketing tags: off')
  await expect(page.locator('#ci-consent-banner')).toHaveCount(0)
  // Google Analytics runs (statistics) with the advertising signals denied, and no Ads conversion.
  const calls = await gtagCalls(page)
  expect(calls).toContainEqual([
    'consent',
    'update',
    expect.objectContaining({ analytics_storage: 'granted', ad_storage: 'denied' }),
  ])
  expect(calls.some(call => call[1] === 'conversion')).toBe(false)

  // An explicit acceptance (via Cookie settings) turns marketing on.
  await page.click('#manage-cookies')
  await page.click('#ci-consent-accept')
  await page.click('#ev-signup')
  await expect
    .poll(async () => (await gtagCalls(page)).some(call => call[1] === 'conversion'))
    .toBe(true)
  await expect(page.locator('#status')).toContainText('Marketing tags: on')
})

test.describe('consent categories', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('playground_categories', '1'))
  })

  test('Customize → statistics only: partial record, analytics on, ad signals denied', async ({
    page,
    request,
  }) => {
    await visitFrom(request, 'DE')
    await page.goto('/pricing?gclid=ADS-1&utm_source=google')

    const region = page.getByRole('region', { name: 'Help us improve your experience' })
    await region.getByRole('button', { name: 'Customize' }).click()
    const statistics = region.getByRole('checkbox', { name: 'Statistics' })
    await expect(statistics).not.toBeChecked() // never pre-ticked
    await expect(region.getByRole('checkbox', { name: 'Necessary' })).toBeDisabled()
    await statistics.check()
    await region.getByRole('button', { name: 'Save choices' }).click()

    await expect
      .poll(() => consents(request))
      .toEqual([
        expect.objectContaining({
          decision: 'partial',
          categories: { preferences: false, statistics: true, marketing: false },
        }),
      ])
    await page.click('#ev-signup')
    await page.click('#flush')
    await expect.poll(() => names(request)).toContain('sign_up')
    const signUp = (await events(request)).find(e => e.name === 'sign_up')!
    expect(signUp.trackingCategory).toBe('full')
    const calls = await gtagCalls(page)
    expect(calls).toContainEqual([
      'consent',
      'update',
      {
        analytics_storage: 'granted',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
      },
    ])
    expect(calls.some(call => call[1] === 'conversion')).toBe(false) // Ads needs marketing

    // Cookie settings reopens the choices with the current selection.
    await page.click('#ci-consent-manage')
    await expect(page.getByRole('checkbox', { name: 'Statistics' })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Marketing' })).not.toBeChecked()
  })
})

test('collector policy "nothing without consent": no events until the visitor accepts', async ({
  page,
  request,
}) => {
  await request.post(`${API}/_dev/policy`, {
    data: { siteKey: 'demo-site', trackingWithoutConsent: 'none' },
  })
  await visitFrom(request, 'DE')
  await page.goto('/')
  await expect(page.locator('#ci-consent-banner')).toBeVisible()
  await page.click('#ev-error') // even essential events wait for consent
  await page.click('#flush')
  await page.waitForTimeout(500)
  expect(await events(request)).toEqual([])

  await page.click('#ci-consent-accept')
  await page.click('#ev-signup')
  await page.click('#flush')
  await expect.poll(() => names(request)).toContain('sign_up')
})
