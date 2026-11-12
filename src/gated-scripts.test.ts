// Consent-gated scripts: which inert scripts become live, when, in what order, and which
// never do. (happy-dom does not execute scripts; execution is covered by e2e/gated.spec.ts.)
import { describe, expect, it, vi } from 'vitest'

import { consentState, makeConfig, settle } from '../test/helpers'
import { GatedScripts } from './gated-scripts'

const UNDECIDED = consentState()
const GRANTED = consentState({ decision: true })
const DENIED = consentState({ decision: false })
const STATISTICS_ONLY = consentState({ decision: { statistics: true } })

function page(html: string) {
  document.body.innerHTML = html
}

/** Live (activated) scripts, in document order. */
const live = () =>
  Array.from(document.querySelectorAll('script:not([type="text/plain"])')) as HTMLScriptElement[]

describe('GatedScripts', () => {
  it('activates nothing before consent, then the allowed categories only', async () => {
    page(`
      <script type="text/plain" data-ci-consent="marketing" src="https://vendor.test/ads.js"></script>
      <script type="text/plain" data-ci-consent="statistics">window.stats = 1</script>`)
    const gated = new GatedScripts(makeConfig())

    gated.apply(UNDECIDED)
    await gated.idle()
    expect(live()).toHaveLength(0)

    gated.apply(STATISTICS_ONLY)
    await gated.idle()
    expect(live().map(s => s.text)).toEqual(['window.stats = 1'])
  })

  it('copies attributes, moves the id, honors data-ci-type, and leaves the inert element in place', async () => {
    page(
      `<script type="text/plain" data-ci-consent="marketing" id="hs-script-loader" async
         src="https://js.hs-scripts.com/123.js" crossorigin="anonymous" referrerpolicy="no-referrer"
         data-ci-cookies="__hs*" data-ci-type="module"></script>`,
    )
    const gated = new GatedScripts(makeConfig())
    gated.apply(GRANTED)
    await gated.idle()

    const [script] = live()
    expect(script!.getAttribute('src')).toBe('https://js.hs-scripts.com/123.js')
    expect(script!.id).toBe('hs-script-loader')
    expect(script!.type).toBe('module')
    expect(script!.getAttribute('crossorigin')).toBe('anonymous')
    expect(script!.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(script!.hasAttribute('data-ci-cookies')).toBe(false)
    const inert = document.querySelector('script[type="text/plain"]')!
    expect(inert.hasAttribute('id')).toBe(false)
    expect(inert.nextElementSibling).toBe(script)
  })

  it('keeps document order: an inline snippet runs only after the library above it has loaded', async () => {
    page(`
      <script type="text/plain" data-ci-consent="marketing" src="https://vendor.test/lib.js"></script>
      <script type="text/plain" data-ci-consent="marketing">vendor.init()</script>`)
    // Capture the live copies instead of connecting them (happy-dom would report them as
    // loaded at once), so the test decides when the library has loaded.
    const inserted: HTMLScriptElement[] = []
    vi.spyOn(Element.prototype, 'after').mockImplementation(function (...nodes) {
      inserted.push(...(nodes as HTMLScriptElement[]))
    })
    const label = (script: HTMLScriptElement) => script.getAttribute('src') ?? script.text

    const gated = new GatedScripts(makeConfig())
    gated.apply(GRANTED)
    await settle()
    // The library is in the page but has not loaded: the inline snippet waits.
    expect(inserted.map(label)).toEqual(['https://vendor.test/lib.js'])
    expect(inserted[0]!.async).toBe(false)

    inserted[0]!.dispatchEvent(new Event('load'))
    await gated.idle()
    expect(inserted.map(label)).toEqual(['https://vendor.test/lib.js', 'vendor.init()'])
  })

  it('a script that fails to load does not block the ones after it', async () => {
    page(`
      <script type="text/plain" data-ci-consent="marketing" src="https://blocked.test/x.js"></script>
      <script type="text/plain" data-ci-consent="marketing">after()</script>`)
    const inserted: HTMLScriptElement[] = []
    vi.spyOn(Element.prototype, 'after').mockImplementation(function (...nodes) {
      inserted.push(...(nodes as HTMLScriptElement[]))
    })
    const gated = new GatedScripts(makeConfig())
    gated.apply(GRANTED)
    await settle()
    expect(inserted).toHaveLength(1)
    inserted[0]!.dispatchEvent(new Event('error'))
    await gated.idle()
    expect(inserted).toHaveLength(2)
  })

  it('a script that never loads blocks the next one for 10 seconds at most', async () => {
    vi.useFakeTimers()
    page(`
      <script type="text/plain" data-ci-consent="marketing" src="https://hangs.test/x.js"></script>
      <script type="text/plain" data-ci-consent="marketing">after()</script>`)
    const inserted: HTMLScriptElement[] = []
    vi.spyOn(Element.prototype, 'after').mockImplementation(function (...nodes) {
      inserted.push(...(nodes as HTMLScriptElement[]))
    })
    const gated = new GatedScripts(makeConfig())
    gated.apply(GRANTED)
    await vi.advanceTimersByTimeAsync(9_000)
    expect(inserted).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_500)
    expect(inserted).toHaveLength(2)
  })

  it('activates each script once, however often consent is applied', async () => {
    page(`<script type="text/plain" data-ci-consent="statistics">once()</script>`)
    const gated = new GatedScripts(makeConfig())
    gated.apply(GRANTED)
    gated.apply(consentState({ decision: { statistics: true, marketing: false } }))
    gated.apply(GRANTED)
    await gated.idle()
    expect(live()).toHaveLength(1)
  })

  it('activates gated scripts added to the page later (single-page apps)', async () => {
    const gated = new GatedScripts(makeConfig())
    gated.apply(GRANTED)
    const container = document.createElement('div')
    container.innerHTML = `<script type="text/plain" data-ci-consent="marketing">late()</script>`
    document.body.append(container)
    await settle()
    await gated.idle()
    expect(live().map(s => s.text)).toEqual(['late()'])
  })

  it('never activates an unknown category', async () => {
    page(`<script type="text/plain" data-ci-consent="marketting">typo()</script>`)
    const gated = new GatedScripts(makeConfig())
    gated.apply(GRANTED)
    await gated.idle()
    expect(live()).toHaveLength(0)
  })

  it('leaves other text/plain scripts alone (templates, JSON data)', async () => {
    page(`<script type="text/plain" id="template">not code</script>`)
    const gated = new GatedScripts(makeConfig())
    gated.apply(GRANTED)
    await gated.idle()
    expect(live()).toHaveLength(0)
  })

  it('honors allowedOrigins for external scripts', async () => {
    page(`
      <script type="text/plain" data-ci-consent="marketing" src="https://good.test/a.js"></script>
      <script type="text/plain" data-ci-consent="marketing" src="https://evil.test/b.js" async></script>`)
    const gated = new GatedScripts(makeConfig(), { allowedOrigins: ['https://good.test'] })
    gated.apply(GRANTED)
    await settle()
    live()[0]?.dispatchEvent(new Event('load'))
    await gated.idle()
    expect(live().map(s => s.getAttribute('src'))).toEqual(['https://good.test/a.js'])
  })
})

describe('GatedScripts: CSP nonces (injected markup must not become code)', () => {
  it('with a known nonce, activates only scripts carrying it, and gives the copy the nonce', async () => {
    page(`
      <script type="text/plain" data-ci-consent="marketing" nonce="r4nd0m">legit()</script>
      <script type="text/plain" data-ci-consent="marketing">injected()</script>
      <script type="text/plain" data-ci-consent="marketing" nonce="guessed">injected2()</script>`)
    const gated = new GatedScripts(makeConfig(), { nonce: 'r4nd0m' })
    gated.apply(GRANTED)
    await gated.idle()

    expect(live().map(s => s.text)).toEqual(['legit()'])
    expect(live()[0]!.nonce || live()[0]!.getAttribute('nonce')).toBe('r4nd0m')
  })

  it('refuses everything, with a warning, when the page uses nonces but none is known', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    page(`
      <script nonce="r4nd0m">/* the page's own script */</script>
      <script type="text/plain" data-ci-consent="marketing">injected()</script>`)
    const gated = new GatedScripts(makeConfig())
    gated.apply(GRANTED)
    await gated.idle()

    expect(live().filter(s => s.text.includes('injected'))).toHaveLength(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('gatedScripts.nonce'))
  })

  it('requireNonce refuses scripts without the nonce on pages with no visible nonce', async () => {
    page(`<script type="text/plain" data-ci-consent="marketing">x()</script>`)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const gated = new GatedScripts(makeConfig(), { requireNonce: true })
    gated.apply(GRANTED)
    await gated.idle()
    expect(live()).toHaveLength(0)
  })
})

describe('GatedScripts: refusal and withdrawal', () => {
  it('deletes the cookies and storage keys gated scripts declare, on refusal', () => {
    document.cookie = '_hjSession_1=x; Path=/'
    document.cookie = 'keep=1; Path=/'
    localStorage.setItem('_hjTLD', 'x')
    page(
      `<script type="text/plain" data-ci-consent="statistics" data-ci-cookies="_hj*, other" data-ci-storage="_hj*">x()</script>`,
    )
    const gated = new GatedScripts(makeConfig())
    gated.apply(DENIED)

    expect(document.cookie).toBe('keep=1')
    expect(localStorage.getItem('_hjTLD')).toBeNull()
  })

  it('requests a reload when a category whose scripts ran is withdrawn, not otherwise', async () => {
    page(`
      <script type="text/plain" data-ci-consent="statistics">stats()</script>
      <script type="text/plain" data-ci-consent="marketing">ads()</script>`)
    const gated = new GatedScripts(makeConfig())
    gated.apply(STATISTICS_ONLY) // only the statistics script runs
    await gated.idle()

    gated.apply(consentState({ decision: { statistics: true, marketing: false } }))
    expect(gated.takeReloadRequest()).toBe(false) // marketing never ran

    gated.apply(DENIED)
    expect(gated.takeReloadRequest()).toBe(true)
    expect(gated.takeReloadRequest()).toBe(false)
  })

  it('a first refusal needs no reload (nothing ran)', () => {
    page(`<script type="text/plain" data-ci-consent="marketing">ads()</script>`)
    const gated = new GatedScripts(makeConfig())
    gated.apply(UNDECIDED)
    gated.apply(DENIED)
    expect(gated.takeReloadRequest()).toBe(false)
  })
})
