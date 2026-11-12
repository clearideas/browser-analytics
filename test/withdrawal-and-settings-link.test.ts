// Changing a decision later: consent settings links (e.g. in the footer), and what a
// withdrawal does to third-party code that is already running (plugins and gated scripts).
import { describe, expect, it, vi } from 'vitest'

import type { AnalyticsPlugin } from '../src/plugins/types'
import { boot, CONSENT_REQUIRED_GEO, FULL_TRACKING_GEO, settle } from './helpers'

const banner = () => document.getElementById('ci-consent-banner')
const manageButton = () => document.getElementById('ci-consent-manage')
const click = (el: Element) =>
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

/** Boot, with a spy on the page reload. */
async function bootWithReloadSpy(options: Parameters<typeof boot>[0]) {
  const booted = await boot(options)
  const dom = await import('../src/plugins/dom')
  const reload = vi.spyOn(dom.pageReloader, 'reload').mockImplementation(() => {})
  return { ...booted, reload }
}

describe('consent settings link', () => {
  it.each([
    ['data attribute', '<a href="/privacy" data-ci-consent-settings>Cookie settings</a>'],
    ['class', '<a href="/privacy" class="footer-link ci-consent-settings">Cookie settings</a>'],
    ['href', '<a href="#ci-consent-settings">Cookie settings</a>'],
    ['button', '<button type="button" data-ci-consent-settings>Cookie settings</button>'],
  ])('a %s reopens the banner, so the visitor can withdraw', async (_, html) => {
    document.body.innerHTML = `<footer>${html}</footer>`
    const { analytics, api } = await boot({ geo: CONSENT_REQUIRED_GEO })
    await analytics.consent.accept()
    expect(banner()).toBeNull()

    const link = document.querySelector('footer > *')!
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(event)

    expect(banner()).not.toBeNull()
    // The link's own navigation (to /privacy, or the #hash) does not happen.
    expect(event.defaultPrevented).toBe(true)
    // Focus moves into the banner (the visitor asked for it).
    expect(banner()!.contains(document.activeElement)).toBe(true)

    document.getElementById('ci-consent-reject')!.click()
    await settle()
    expect(api.consentRecords().map(r => r.decision)).toEqual(['granted', 'denied'])
  })

  it('works for a click inside the link (e.g. on an icon)', async () => {
    document.body.innerHTML = `<a href="#" data-ci-consent-settings><span id="icon">⚙</span> Privacy</a>`
    await boot({ geo: FULL_TRACKING_GEO })
    click(document.getElementById('icon')!)
    expect(banner()).not.toBeNull()
  })

  it('also works where consent is not required (a visitor can still opt out)', async () => {
    document.body.innerHTML = `<a href="#ci-consent-settings">Privacy choices</a>`
    const { analytics } = await boot({ geo: FULL_TRACKING_GEO })
    click(document.querySelector('a')!)
    document.getElementById('ci-consent-reject')!.click()
    await settle()
    expect(analytics.consent.get().categories.marketing).toBe(false)
  })

  it('replaces the floating "Cookie settings" button (manageButton: auto)', async () => {
    document.body.innerHTML = `<footer><a href="#ci-consent-settings">Cookie settings</a></footer>`
    const { analytics } = await boot({ geo: CONSENT_REQUIRED_GEO })
    await analytics.consent.accept()
    expect(manageButton()).toBeNull()
  })

  it('updates when a SPA footer is mounted, removed and mounted again', async () => {
    const { analytics } = await boot({ geo: CONSENT_REQUIRED_GEO })
    await analytics.consent.accept()
    expect(manageButton()?.hidden).toBe(false)
    const footer = document.createElement('footer')
    footer.innerHTML = '<a href="#ci-consent-settings">Cookie settings</a>'
    document.body.append(footer)
    await vi.waitFor(() => expect(manageButton()?.hidden).toBe(true))
    click(footer.querySelector('a')!)
    expect(banner()).not.toBeNull()
    footer.remove()
    await settle()
    expect(banner()).not.toBeNull()
    expect(manageButton()?.hidden).toBe(true)
    await analytics.consent.accept()
    await vi.waitFor(() => expect(manageButton()?.hidden).toBe(false))
    document.body.append(footer)
    await vi.waitFor(() => expect(manageButton()?.hidden).toBe(true))
  })

  it.each([
    ['data-ci-consent-settings', ''],
    ['href', '#ci-consent-settings'],
    ['class', 'ci-consent-settings'],
  ])('updates when a SPA adds or removes the %s marker', async (attribute, value) => {
    document.body.innerHTML = '<footer><a>Preferences</a></footer>'
    const { analytics } = await boot({ geo: CONSENT_REQUIRED_GEO })
    await analytics.consent.accept()
    expect(manageButton()?.hidden).toBe(false)
    const link = document.querySelector('footer a')!
    link.setAttribute(attribute, value)
    await vi.waitFor(() => expect(manageButton()?.hidden).toBe(true))
    link.removeAttribute(attribute)
    await vi.waitFor(() => expect(manageButton()?.hidden).toBe(false))
  })

  it('manageButton: true still shows the floating button next to the link', async () => {
    document.body.innerHTML = `<a href="#ci-consent-settings">Cookie settings</a>`
    const { analytics } = await boot({
      geo: CONSENT_REQUIRED_GEO,
      config: { banner: { manageButton: true } },
    })
    await analytics.consent.accept()
    expect(manageButton()).not.toBeNull()
  })

  it('opens the banner on arrival at #ci-consent-settings (link clicked before the script loaded)', async () => {
    window.history.replaceState(null, '', '/about#ci-consent-settings')
    await boot({ geo: FULL_TRACKING_GEO })
    expect(banner()).not.toBeNull()
  })

  it('opens on arrival at #ci-consent-settings even with autoShow: false', async () => {
    window.history.replaceState(null, '', '/#ci-consent-settings')
    await boot({ geo: CONSENT_REQUIRED_GEO, config: { banner: { autoShow: false } } })
    expect(banner()).not.toBeNull()
  })

  it('autoShow: false without the hash shows nothing to an undecided visitor', async () => {
    await boot({ geo: CONSENT_REQUIRED_GEO, config: { banner: { autoShow: false } } })
    expect(banner()).toBeNull()
    expect(manageButton()).toBeNull()
  })

  it('does nothing with banner: false (the site provides its own UI)', async () => {
    document.body.innerHTML = `<a href="#ci-consent-settings">Cookie settings</a>`
    await boot({ geo: CONSENT_REQUIRED_GEO, config: { banner: false } })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    document.querySelector('a')!.dispatchEvent(event)
    expect(banner()).toBeNull()
    expect(event.defaultPrevented).toBe(false)
  })

  it('ignores ordinary links', async () => {
    document.body.innerHTML = `<a href="/pricing">Pricing</a>`
    await boot({ geo: FULL_TRACKING_GEO })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    document.querySelector('a')!.dispatchEvent(event)
    expect(banner()).toBeNull()
    expect(event.defaultPrevented).toBe(false)
  })
})

describe('withdrawal reloads the page only when running code cannot be stopped', () => {
  const vendor = (overrides: Partial<AnalyticsPlugin>): AnalyticsPlugin => ({
    name: 'vendor',
    category: 'marketing',
    load: () => {},
    track: () => {},
    ...overrides,
  })

  it('a plugin that stops in place: no reload', async () => {
    const { analytics, reload } = await bootWithReloadSpy({
      geo: CONSENT_REQUIRED_GEO,
      config: { plugins: [vendor({ consentChanged: () => {} })] },
    })
    await analytics.consent.accept()
    await settle()
    await analytics.consent.reject()
    expect(reload).not.toHaveBeenCalled()
  })

  it('a plugin that cannot be stopped: reload after the decision is recorded', async () => {
    const { analytics, api, reload } = await bootWithReloadSpy({
      geo: CONSENT_REQUIRED_GEO,
      config: { plugins: [vendor({ withdrawal: 'reload' })] },
    })
    await analytics.consent.accept()
    await settle()
    await analytics.consent.reject()

    expect(reload).toHaveBeenCalledTimes(1)
    // Stored and recorded before the reload, so the next page starts refused.
    expect(api.consentRecords().map(r => r.decision)).toEqual(['granted', 'denied'])
    expect(JSON.parse(localStorage.getItem('ci_consent_status')!).consented).toBe(false)
  })

  it('a custom plugin without consentChanged cannot stop its vendor: reload by default', async () => {
    const { analytics, reload } = await bootWithReloadSpy({
      geo: CONSENT_REQUIRED_GEO,
      config: { plugins: [vendor({})] },
    })
    await analytics.consent.accept()
    await settle()
    await analytics.consent.reject()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('no reload when the first decision is a refusal (nothing ran)', async () => {
    const { analytics, reload } = await bootWithReloadSpy({
      geo: CONSENT_REQUIRED_GEO,
      config: { plugins: [vendor({ withdrawal: 'reload' })] },
    })
    await analytics.consent.reject()
    expect(reload).not.toHaveBeenCalled()
  })

  it('consent.reloadOnWithdrawal: false turns the reload off', async () => {
    const { analytics, reload } = await bootWithReloadSpy({
      geo: CONSENT_REQUIRED_GEO,
      config: {
        plugins: [vendor({ withdrawal: 'reload' })],
        consent: { reloadOnWithdrawal: false },
      },
    })
    await analytics.consent.accept()
    await settle()
    await analytics.consent.reject()
    expect(reload).not.toHaveBeenCalled()
  })

  it('a directory plugin that cannot be stopped (Hotjar) reloads, one that can (Meta Pixel) does not', async () => {
    const hotjar = await bootWithReloadSpy({
      geo: CONSENT_REQUIRED_GEO,
      config: { integrations: { hotjar: { siteId: 123 } } },
    })
    await hotjar.analytics.consent.accept()
    // Plugin code is loaded with import(): wait until Hotjar is set up.
    await vi.waitFor(() => expect(window._hjSettings).toBeDefined())
    await hotjar.analytics.consent.reject()
    expect(hotjar.reload).toHaveBeenCalledTimes(1)
  })

  it('Meta Pixel stops in place: no reload', async () => {
    const meta = await bootWithReloadSpy({
      geo: CONSENT_REQUIRED_GEO,
      config: { integrations: { metaPixel: { pixelId: '123456789' } } },
    })
    await meta.analytics.consent.accept()
    await vi.waitFor(() => expect(window.fbq).toBeDefined())
    await meta.analytics.consent.reject()
    expect(meta.reload).not.toHaveBeenCalled()
    const queue = (window as any).fbq.queue
    expect(queue[queue.length - 1]).toEqual(['consent', 'revoke'])
  })
})

describe('consent-gated scripts in the running library', () => {
  const gated = `
    <script type="text/plain" data-ci-consent="marketing" data-ci-cookies="_vendor*">window.vendorRan = true</script>`
  // Gated scripts and their live copies are in the body (plugins add theirs to <head>).
  const live = () => document.body.querySelectorAll('script:not([type="text/plain"])')

  it('stay inert until the visitor accepts, then run', async () => {
    document.body.innerHTML = gated
    const { analytics } = await boot({ geo: CONSENT_REQUIRED_GEO })
    expect(live()).toHaveLength(0)

    await analytics.consent.accept()
    await settle()
    expect(live()).toHaveLength(1)
  })

  it('run without a decision where consent is not required', async () => {
    document.body.innerHTML = gated
    await boot({ geo: FULL_TRACKING_GEO })
    await settle()
    expect(live()).toHaveLength(1)
  })

  it('withdrawal deletes their declared cookies and reloads the page', async () => {
    document.body.innerHTML = gated
    const { analytics, reload } = await bootWithReloadSpy({ geo: CONSENT_REQUIRED_GEO })
    await analytics.consent.accept()
    await settle()
    document.cookie = '_vendor_id=1; Path=/'

    await analytics.consent.reject()
    expect(document.cookie).not.toContain('_vendor_id')
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('gatedScripts: false leaves them alone', async () => {
    document.body.innerHTML = gated
    const { analytics } = await boot({ geo: CONSENT_REQUIRED_GEO, config: { gatedScripts: false } })
    await analytics.consent.accept()
    await settle()
    expect(live()).toHaveLength(0)
  })
})
