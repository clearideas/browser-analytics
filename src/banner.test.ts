import { describe, expect, it, vi } from 'vitest'

import {
  hideManageButton,
  removeConsentUi,
  resolveBannerOptions,
  resolvePrivacyPolicyUrl,
  showBanner,
  showManageButton,
} from './banner'

const handlers = () => ({ onAccept: vi.fn(), onReject: vi.fn() })
const banner = () => document.getElementById('ci-consent-banner')!

describe('consent banner', () => {
  it('is a labelled region with a heading, description and two equivalent buttons', () => {
    showBanner(resolveBannerOptions(undefined), handlers())

    const region = banner()
    expect(region.tagName).toBe('SECTION')
    expect(document.getElementById(region.getAttribute('aria-labelledby')!)!.textContent).toBe(
      'Help us improve your experience',
    )
    expect(document.getElementById(region.getAttribute('aria-describedby')!)!.tagName).toBe('P')
    const accept = document.getElementById('ci-consent-accept')!
    const reject = document.getElementById('ci-consent-reject')!
    expect(accept.getAttribute('type')).toBe('button')
    expect(reject.getAttribute('type')).toBe('button')
    // Equally prominent: same element type and classes.
    expect(accept.className).toBe(reject.className)
    expect(document.getElementById('ci-consent-styles')).not.toBeNull()
  })

  it('renders configured text as text, never as HTML', () => {
    const attack = '<img src=x onerror="window.__pwned=1">'
    showBanner(
      resolveBannerOptions({
        title: attack,
        message: attack,
        acceptLabel: attack,
        privacyLinkLabel: attack,
      }),
      handlers(),
    )

    expect(banner().querySelector('img')).toBeNull()
    expect(banner().textContent).toContain(attack)
    expect((window as any).__pwned).toBeUndefined()
  })

  it('uses translated labels and a top position', () => {
    showBanner(
      resolveBannerOptions({
        acceptLabel: 'Alle akzeptieren',
        rejectLabel: 'Nur notwendige',
        position: 'top',
      }),
      handlers(),
    )

    expect(document.getElementById('ci-consent-accept')!.textContent).toBe('Alle akzeptieren')
    expect(document.getElementById('ci-consent-reject')!.textContent).toBe('Nur notwendige')
    expect(banner().className).toContain('ci-consent--top')
  })

  it('can leave styling entirely to the site', () => {
    showBanner(resolveBannerOptions({ injectStyles: false }), handlers())
    expect(document.getElementById('ci-consent-styles')).toBeNull()
  })

  it('calls the handler and removes itself on a decision', () => {
    const h = handlers()
    showBanner(resolveBannerOptions(undefined), h)

    document.getElementById('ci-consent-reject')!.click()

    expect(h.onReject).toHaveBeenCalledTimes(1)
    expect(h.onAccept).not.toHaveBeenCalled()
    expect(document.getElementById('ci-consent-banner')).toBeNull()
  })

  it('is shown only once at a time', () => {
    showBanner(resolveBannerOptions(undefined), handlers())
    showBanner(resolveBannerOptions(undefined), handlers())
    expect(document.querySelectorAll('#ci-consent-banner')).toHaveLength(1)
  })

  it('does not move focus when shown on page load', () => {
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()

    showBanner(resolveBannerOptions(undefined), handlers())

    expect(document.activeElement).toBe(input)
  })

  it('when opened by the visitor, takes focus and returns it afterwards', () => {
    const options = resolveBannerOptions(undefined)
    showManageButton(options, () => {})
    const settings = document.getElementById('ci-consent-manage')!
    settings.focus()

    showBanner(options, handlers(), { focus: true })
    expect(document.activeElement!.id).toBe('ci-consent-reject')
    document.getElementById('ci-consent-accept')!.focus()
    document.getElementById('ci-consent-accept')!.click()

    expect(document.activeElement).toBe(settings)
  })
})

describe('privacy policy link', () => {
  it('accepts http(s) URLs and falls back to /privacy otherwise', () => {
    expect(resolvePrivacyPolicyUrl('https://example.com/legal/privacy')).toBe(
      'https://example.com/legal/privacy',
    )
    expect(resolvePrivacyPolicyUrl('javascript:alert(1)')).toBe('/privacy')
    expect(resolvePrivacyPolicyUrl('data:text/html,hi')).toBe('/privacy')
    expect(resolvePrivacyPolicyUrl(undefined, 'https://example.com/app')).toBe(
      'https://example.com/app/privacy',
    )
    expect(resolvePrivacyPolicyUrl(undefined, 'javascript:alert(1)')).toBe('/privacy')
    expect(resolvePrivacyPolicyUrl()).toBe('/privacy')
  })

  it('is rendered as a link', () => {
    showBanner(resolveBannerOptions({ privacyPolicyUrl: 'https://example.com/p' }), handlers())
    expect(banner().querySelector('a')!.getAttribute('href')).toBe('https://example.com/p')
  })
})

describe('"Cookie settings" button', () => {
  it('is created once, hidden rather than removed, and calls back on click', () => {
    const onClick = vi.fn()
    const options = resolveBannerOptions({ manageLabel: 'Privacy choices' })
    showManageButton(options, onClick)
    showManageButton(options, onClick)
    const button = document.getElementById('ci-consent-manage')!

    expect(document.querySelectorAll('#ci-consent-manage')).toHaveLength(1)
    expect(button.textContent).toBe('Privacy choices')
    button.click()
    expect(onClick).toHaveBeenCalledTimes(1)

    hideManageButton()
    expect(button.hidden).toBe(true)
    showManageButton(options, onClick)
    expect(button.hidden).toBe(false)

    removeConsentUi()
    expect(document.getElementById('ci-consent-manage')).toBeNull()
  })
})

describe('categories mode', () => {
  const undecided = { preferences: null, statistics: null, marketing: null }
  const offered = ['preferences', 'statistics', 'marketing'] as const

  it('adds an equally styled "Customize" button that reveals labelled category checkboxes', () => {
    showBanner(resolveBannerOptions(undefined), handlers(), {
      categories: { offered: [...offered], current: undecided },
    })
    const customize = document.getElementById('ci-consent-customize')!
    const panel = document.getElementById('ci-consent-categories')!

    expect(customize.className).toBe(document.getElementById('ci-consent-accept')!.className)
    expect(panel.tagName).toBe('FIELDSET')
    expect(panel.hidden).toBe(true)
    expect(customize.getAttribute('aria-expanded')).toBe('false')

    customize.click()

    expect(panel.hidden).toBe(false)
    expect(customize.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement!.id).toBe('ci-consent-category-preferences')
    const statistics = document.getElementById('ci-consent-category-statistics') as HTMLInputElement
    expect(document.querySelector('label[for="ci-consent-category-statistics"]')!.textContent).toBe(
      'Statistics',
    )
    expect(
      document.getElementById(statistics.getAttribute('aria-describedby')!)!.textContent,
    ).toContain('understand how the site is used')
  })

  it('never pre-ticks optional categories; necessary is on and cannot be changed', () => {
    showBanner(resolveBannerOptions(undefined), handlers(), {
      categories: { offered: [...offered], current: undecided, expanded: true },
    })
    const box = (c: string) =>
      document.getElementById(`ci-consent-category-${c}`) as HTMLInputElement

    expect(box('necessary').checked).toBe(true)
    expect(box('necessary').disabled).toBe(true)
    for (const category of offered) expect(box(category).checked).toBe(false)
  })

  it('shows the current choices and saves the selection', () => {
    const h = { ...handlers(), onSave: vi.fn() }
    showBanner(resolveBannerOptions(undefined), h, {
      categories: {
        offered: ['statistics', 'marketing'],
        current: { preferences: null, statistics: true, marketing: false },
        expanded: true,
      },
    })
    expect(document.getElementById('ci-consent-category-preferences')).toBeNull() // not offered
    ;(document.getElementById('ci-consent-category-marketing') as HTMLInputElement).click()

    document.getElementById('ci-consent-save')!.click()

    expect(h.onSave).toHaveBeenCalledWith({ statistics: true, marketing: true })
    expect(document.getElementById('ci-consent-banner')).toBeNull()
  })

  it('opened by the visitor with the choices expanded, focus goes to the first choice', () => {
    showBanner(resolveBannerOptions(undefined), handlers(), {
      focus: true,
      categories: { offered: [...offered], current: undecided, expanded: true },
    })
    expect(document.activeElement!.id).toBe('ci-consent-category-preferences')
  })

  it('uses configured category texts', () => {
    showBanner(
      resolveBannerOptions({
        customizeLabel: 'Anpassen',
        saveLabel: 'Auswahl speichern',
        categoryText: { statistics: { label: 'Statistik' } },
      }),
      handlers(),
      { categories: { offered: [...offered], current: undecided } },
    )
    expect(document.getElementById('ci-consent-customize')!.textContent).toBe('Anpassen')
    expect(document.getElementById('ci-consent-save')!.textContent).toBe('Auswahl speichern')
    expect(document.querySelector('label[for="ci-consent-category-statistics"]')!.textContent).toBe(
      'Statistik',
    )
    // Unconfigured parts keep their defaults.
    expect(document.querySelector('label[for="ci-consent-category-marketing"]')!.textContent).toBe(
      'Marketing',
    )
  })

  it('simple mode has no Customize button or category choices', () => {
    showBanner(resolveBannerOptions(undefined), handlers())
    expect(document.getElementById('ci-consent-customize')).toBeNull()
    expect(document.getElementById('ci-consent-categories')).toBeNull()
  })
})
