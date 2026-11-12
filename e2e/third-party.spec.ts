// Third-party tools in a real browser: directory plugins loaded from separate files with
// Subresource Integrity, consent-gated scripts under a strict CSP, the footer settings
// link, and withdrawal (cleanup and reload). Page: /tools/ (sample-host/src/server.ts).
import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

const API = 'http://localhost:18787'

const pageErrors: string[] = []
let requests: string[] = []

test.beforeEach(async ({ request, page }) => {
  await request.post(`${API}/_dev/reset`)
  await request.post(`${API}/_dev/geo`, { data: { country: 'DE', continent: 'EU' } })
  pageErrors.length = 0
  requests = []
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('request', req => requests.push(new URL(req.url()).pathname))
})
test.afterEach(() => expect(pageErrors).toEqual([]))

const value = (page: Page, expression: string) => page.evaluate(expression)
const cookieNames = async (page: Page) =>
  (await page.context().cookies()).map(cookie => cookie.name).sort()
const consentDecisions = async (request: APIRequestContext) =>
  ((await (await request.get(`${API}/_dev/consents`)).json()) as any[]).map(c => c.decision)

async function accept(page: Page) {
  await page
    .getByRole('region', { name: 'Cookies on the tools demo' })
    .getByRole('button', {
      name: 'Accept all',
    })
    .click()
}

test('nothing third-party is downloaded or run before consent', async ({ page }) => {
  await page.goto('/tools/')
  await expect(page.getByRole('region', { name: 'Cookies on the tools demo' })).toBeVisible()
  await page.waitForTimeout(300)

  expect(
    requests.filter(path => path.startsWith('/vendor/') || path.includes('script-plugins')),
  ).toEqual([])
  expect(await value(page, 'window.vendorLib')).toBeUndefined()
  expect(await value(page, 'typeof window.fbq')).toBe('undefined')
})

test('on accept: plugins load from integrity-checked files, gated scripts run in order, injected markup does not', async ({
  page,
}) => {
  await page.goto('/tools/')
  await accept(page)

  // Directory plugins: their code came from separate files next to analytics.js.
  await expect.poll(() => value(page, 'window.__hotjarRuns')).toBe(1)
  await expect
    .poll(() => value(page, 'window.__meta'))
    .toEqual([
      ['consent', 'grant'],
      ['set', 'autoConfig', false, '1234567890'],
      ['init', '1234567890'],
      ['track', 'PageView'],
    ])
  expect(requests.filter(path => path.includes('script-plugins')).sort()).toEqual([
    expect.stringMatching(/^\/lib\/script-plugins\/hotjar\.[0-9a-f]+\.js$/),
    expect.stringMatching(/^\/lib\/script-plugins\/metaPixel\.[0-9a-f]+\.js$/),
  ])

  // Gated scripts ran, the inline snippet after the library it depends on.
  await expect.poll(() => value(page, 'window.vendorLib')).toBe(true)
  await expect.poll(() => value(page, 'window.inlineSawLib')).toBe(true)

  // The page's CSP trusts scripts the library creates ('strict-dynamic'); the visitor's
  // injected inert scripts carry no nonce, so they were never turned into code.
  expect(await value(page, 'window.injectedInline')).toBeUndefined()
  expect(await value(page, 'window.injectedExternal')).toBeUndefined()
  expect(requests).not.toContain('/vendor/evil.js')
})

test('withdrawal through the footer link: data removed, page reloaded, nothing runs again', async ({
  page,
  request,
}) => {
  await page.goto('/tools/')
  await accept(page)
  await expect.poll(() => value(page, 'window.__hotjarRuns')).toBe(1)
  await expect.poll(() => value(page, 'window.inlineSawLib')).toBe(true)
  expect(await cookieNames(page)).toEqual(
    expect.arrayContaining(['_hjSession_42', '_vendorlib_id']),
  )

  // The floating button is not shown: the footer link replaces it.
  await expect(page.locator('#ci-consent-manage')).toHaveCount(0)
  await page.getByRole('link', { name: 'Cookie settings' }).click()
  const banner = page.getByRole('region', { name: 'Cookies on the tools demo' })
  await expect(banner).toBeVisible()
  await expect(banner.getByRole('button', { name: 'Reject non-essential' })).toBeFocused()

  // Hotjar and the gated scripts cannot be stopped in place: the page reloads.
  await Promise.all([
    page.waitForEvent('load'),
    banner.getByRole('button', { name: 'Reject non-essential' }).click(),
  ])
  await expect.poll(() => consentDecisions(request)).toEqual(['granted', 'denied'])
  await page.waitForTimeout(300)

  expect(await value(page, 'window.__hotjarRuns')).toBeUndefined()
  expect(await value(page, 'window.vendorLib')).toBeUndefined()
  expect(await value(page, 'typeof window.fbq')).toBe('undefined')
  const cookies = await cookieNames(page)
  expect(cookies).not.toContain('_hjSession_42')
  expect(cookies).not.toContain('_vendorlib_id')
  expect(await value(page, "localStorage.getItem('_hjLocal')")).toBeNull()
  // The page did not reload a second time, and no banner asks again.
  await expect(banner).toHaveCount(0)
})

test('a tampered plugin file is blocked by its integrity hash; the page keeps working', async ({
  page,
  request,
}) => {
  const consoleErrors: string[] = []
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.goto('/tools/?lib=tampered')
  await accept(page)
  await expect.poll(() => consentDecisions(request)).toEqual(['granted'])
  await page.waitForTimeout(500)

  expect(await value(page, 'window.tampered')).toBeUndefined()
  expect(await value(page, 'window.__hotjarRuns')).toBeUndefined()
  expect(consoleErrors.join('\n')).toMatch(/integrity/i)
  // The library itself and the gated scripts are unaffected.
  expect(await value(page, 'window.vendorLib')).toBe(true)
})

test('without a CSP, gated scripts need no nonce', async ({ page }) => {
  await page.goto('/tools/?csp=off')
  await accept(page)
  await expect.poll(() => value(page, 'window.inlineSawLib')).toBe(true)
})

test('a US visitor (no consent required) can still opt out through the footer link', async ({
  page,
  request,
}) => {
  await request.post(`${API}/_dev/geo`, { data: { country: 'US', continent: 'NA' } })
  await page.goto('/tools/')
  // Consent not required: tools run without a banner.
  await expect.poll(() => value(page, 'window.inlineSawLib')).toBe(true)
  await expect(page.getByRole('region', { name: 'Cookies on the tools demo' })).toHaveCount(0)

  await page.getByRole('link', { name: 'Cookie settings' }).click()
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: 'Reject non-essential' }).click(),
  ])
  await page.waitForTimeout(300)
  expect(await value(page, 'window.vendorLib')).toBeUndefined()
  expect(await consentDecisions(request)).toEqual(['denied'])
})
