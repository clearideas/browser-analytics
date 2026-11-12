// The script-tag build (dist/analytics.js) on a plain site, in a real browser.
import type { APIRequestContext } from '@playwright/test'
import { expect, test } from '@playwright/test'

const API = 'http://localhost:18787'

const events = async (request: APIRequestContext): Promise<any[]> =>
  (await request.get(`${API}/_dev/events`)).json()
const seen = async (request: APIRequestContext) =>
  (await events(request)).map(e => `${e.name} ${e.props.path ?? ''}`.trim())

const pageErrors: string[] = []
test.beforeEach(async ({ request, page }) => {
  await request.post(`${API}/_dev/reset`)
  pageErrors.length = 0
  page.on('pageerror', error => pageErrors.push(error.message))
})
test.afterEach(() => expect(pageErrors).toEqual([]))

test('a script tag is all a plain site needs', async ({ page, request }) => {
  await request.post(`${API}/_dev/geo`, { data: { country: 'US' } })
  await page.goto('/plain/first')

  await expect.poll(() => seen(request)).toContain('page_view /plain/first')
  // A command queued inline before the async script loaded is run once it is ready.
  // (Custom events are batched; flush to deliver them now.)
  await page.evaluate(() => (window as any).ClearIdeasAnalytics.get().flush())
  await expect.poll(() => seen(request)).toContain('queued_before_load')
  expect(
    await page.evaluate(() => typeof (window as any).ClearIdeasAnalytics.get().trackEvent),
  ).toBe('function')
})

test('pushState navigations and full page loads are both tracked', async ({ page, request }) => {
  await request.post(`${API}/_dev/geo`, { data: { country: 'US' } })
  await page.goto('/plain/first')
  await expect.poll(() => seen(request)).toContain('page_view /plain/first')

  await page.click('#spa-nav') // history.pushState: detected by the History API watcher
  await expect.poll(() => seen(request)).toContain('page_view /plain/spa')
  expect(await seen(request)).toContain('page_exit /plain/first')

  await page.click('#full-load') // a real navigation: the old page sends page_exit by beacon
  await expect.poll(() => seen(request)).toContain('page_view /plain/second')
  await expect.poll(() => seen(request)).toContain('page_exit /plain/spa')
  expect((await seen(request)).filter(e => e === 'page_view /plain/first')).toHaveLength(1)
})

test('the banner (with texts from window.ciAnalyticsConfig) and consent work from the script tag', async ({
  page,
  request,
}) => {
  await request.post(`${API}/_dev/geo`, { data: { country: 'DE' } })
  await page.goto('/plain/first')

  const region = page.getByRole('region', { name: 'Cookies on this plain site' })
  await expect(region).toBeVisible()
  await region.getByRole('button', { name: 'Accept all' }).click()
  await expect
    .poll(async () =>
      ((await (await request.get(`${API}/_dev/consents`)).json()) as any[]).map(c => c.decision),
    )
    .toEqual(['granted'])

  await page.click('#track')
  await page.evaluate(() => (window as any).ClearIdeasAnalytics.get().flush())
  await expect.poll(() => seen(request)).toContain('plain_click')
  const click = (await events(request)).find(e => e.name === 'plain_click')
  expect(click.trackingCategory).toBe('full')
})
