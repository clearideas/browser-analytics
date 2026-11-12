// The same scenarios against every example app: a real build of each framework using the
// packed library, served from its own origin, talking to the sample collector.
import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { APPS } from '../examples/apps.mjs'

const API = 'http://localhost:18787'
const selected = process.env.EXAMPLES?.split(',')

interface StoredEvent {
  name: string
  origin: string
  trackingCategory: string
  props: Record<string, any>
}

const eventsFrom = async (request: APIRequestContext, origin: string): Promise<StoredEvent[]> =>
  ((await (await request.get(`${API}/_dev/events`)).json()) as StoredEvent[]).filter(
    e => e.origin === origin,
  )
const paths = async (request: APIRequestContext, origin: string, name: string) =>
  (await eventsFrom(request, origin)).filter(e => e.name === name).map(e => e.props.path)

function watchErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

for (const app of APPS.filter(a => !selected || selected.includes(a.name))) {
  const origin = `http://localhost:${app.port}`

  test.describe(`${app.name} (${app.integration})`, () => {
    test.beforeEach(async ({ request }) => {
      await request.post(`${API}/_dev/reset`)
    })

    test('page views, client-side navigation and custom events reach the collector', async ({
      page,
      request,
    }) => {
      const errors = watchErrors(page)
      await request.post(`${API}/_dev/geo`, { data: { country: 'US' } })

      await page.goto(`${origin}/`)
      await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
      await expect.poll(() => paths(request, origin, 'page_view')).toEqual(['/'])

      await page.click('#nav-pricing')
      await expect(page.getByRole('heading', { name: 'Pricing' })).toBeVisible()
      await expect.poll(() => paths(request, origin, 'page_view')).toEqual(['/', '/pricing'])

      await page.click('#nav-home')
      await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
      await expect.poll(() => paths(request, origin, 'page_view')).toEqual(['/', '/pricing', '/'])
      expect(await paths(request, origin, 'page_exit')).toEqual(['/', '/pricing'])

      await page.click('#cta')
      await page.goto('about:blank') // leaving the site delivers the queued event by beacon
      await expect
        .poll(async () => (await eventsFrom(request, origin)).map(e => e.name))
        .toContain('cta_click')
      const cta = (await eventsFrom(request, origin)).find(e => e.name === 'cta_click')!
      expect(cta).toMatchObject({ trackingCategory: 'full', props: { framework: app.name } })
      expect(errors).toEqual([])
    })

    test('an undecided visitor still sees the banner after client-side navigation', async ({
      page,
      request,
    }) => {
      const errors = watchErrors(page)
      await request.post(`${API}/_dev/geo`, { data: { country: 'DE' } })
      await page.goto(`${origin}/`)
      const banner = page.getByRole('region', { name: 'Help us improve your experience' })
      await expect(banner).toBeVisible()

      await page.click('#nav-pricing')
      await expect(page.getByRole('heading', { name: 'Pricing' })).toBeVisible()

      await expect(banner).toBeVisible()
      await expect(banner).toHaveCount(1)
      expect(errors).toEqual([])
    })

    test('visitor in a consent region: banner, then a consent record from this origin', async ({
      page,
      request,
    }) => {
      const errors = watchErrors(page)
      await request.post(`${API}/_dev/geo`, { data: { country: 'DE' } })

      await page.goto(`${origin}/`)
      const banner = page.getByRole('region', { name: 'Help us improve your experience' })
      await expect(banner).toBeVisible()
      await expect
        .poll(async () =>
          (await eventsFrom(request, origin)).every(e => e.trackingCategory === 'limited'),
        )
        .toBe(true)

      await banner.getByRole('button', { name: 'Accept all' }).click()

      await expect
        .poll(async () =>
          ((await (await request.get(`${API}/_dev/consents`)).json()) as any[]).map(c => [
            c.decision,
            c.origin,
          ]),
        )
        .toEqual([['granted', origin]])
      if (await page.locator('#consent-state').count()) {
        await expect(page.locator('#consent-state')).toHaveText('statistics:true')
      }
      await page.click('#nav-pricing')
      await expect
        .poll(
          async () =>
            (await eventsFrom(request, origin)).filter(e => e.name === 'page_view').slice(-1)[0]
              ?.trackingCategory,
        )
        .toBe('full')
      expect(errors).toEqual([])
    })

    test('the footer "Cookie settings" link reopens the banner after navigating, to withdraw', async ({
      page,
      request,
    }) => {
      const errors = watchErrors(page)
      await request.post(`${API}/_dev/geo`, { data: { country: 'DE' } })
      await page.goto(`${origin}/`)
      const banner = page.getByRole('region', { name: 'Help us improve your experience' })
      await banner.getByRole('button', { name: 'Accept all' }).click()
      await expect(banner).toHaveCount(0)
      // The page has its own link, so no floating button is added.
      await expect(page.locator('#ci-consent-manage')).toHaveCount(0)

      // After a client-side navigation (the router must not take over the link).
      await page.evaluate(() => ((window as any).__samePage = true))
      await page.click('#nav-pricing')
      await expect(page.getByRole('heading', { name: 'Pricing' })).toBeVisible()
      await page.click('#cookie-settings')

      await expect(banner).toBeVisible()
      await expect(banner.getByRole('button', { name: 'Reject non-essential' })).toBeFocused()
      await banner.getByRole('button', { name: 'Reject non-essential' }).click()
      await expect
        .poll(async () =>
          ((await (await request.get(`${API}/_dev/consents`)).json()) as any[]).map(
            c => c.decision,
          ),
        )
        .toEqual(['granted', 'denied'])
      // No navigation happened: same page, no #hash added.
      expect(page.url()).toBe(`${origin}/pricing`)
      expect(await page.evaluate(() => (window as any).__samePage)).toBe(true)
      expect(errors).toEqual([])
    })
  })
}
