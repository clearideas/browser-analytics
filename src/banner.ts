// Framework-neutral consent banner and "Cookie settings" button.
import type {
  CategoryChoices,
  CategoryState,
  ConsentCategory,
  OptionalCategory,
} from './categories'
//
// Built with DOM APIs only (configured text is never parsed as HTML). Accept and reject
// are equally prominent (GDPR: consent must be freely given and as easy to refuse or
// withdraw as to give, Art. 4(11) and 7(3); see README "Why it works this way").
// Styles use CSS custom properties (--ci-consent-*) so sites can theme it, or can be
// turned off entirely (injectStyles: false).

export interface BannerOptions {
  title?: string
  message?: string
  acceptLabel?: string
  rejectLabel?: string
  /** Privacy policy link (http/https only). Default: <websiteBaseUrl>privacy, or /privacy. */
  privacyPolicyUrl?: string
  privacyLinkLabel?: string
  position?: 'bottom' | 'top'
  /**
   * Show the banner automatically to visitors who have not decided (default true).
   * false: show it yourself with analytics.consent.showBanner(), e.g. on some pages only.
   */
  autoShow?: boolean
  /** Inject the default stylesheet (default true). */
  injectStyles?: boolean
  /**
   * Floating "Cookie settings" button to change a decision later.
   * "auto" (default): shown where consent is required, once the visitor has decided,
   * unless the page has its own consent settings link (see CONSENT_SETTINGS_SELECTOR).
   * true: always shown. false: never.
   */
  manageButton?: boolean | 'auto'
  manageLabel?: string
  /** 'categories' mode: the button that opens the per-category choices. */
  customizeLabel?: string
  /** 'categories' mode: the button that saves the per-category choices. */
  saveLabel?: string
  /** 'categories' mode: heading of the per-category choices. */
  categoriesLegend?: string
  /** 'categories' mode: label and description per category. */
  categoryText?: Partial<Record<ConsentCategory, { label?: string; description?: string }>>
}

export type ResolvedBannerOptions = Required<
  Omit<BannerOptions, 'privacyPolicyUrl' | 'categoryText'>
> & {
  privacyPolicyUrl: string
  categoryText: Record<ConsentCategory, { label: string; description: string }>
}

export const BANNER_ID = 'ci-consent-banner'
/**
 * Elements that open the consent settings (e.g. a footer link), matched on click:
 * `data-ci-consent-settings`, the class `ci-consent-settings`, or href="#ci-consent-settings".
 */
export const CONSENT_SETTINGS_SELECTOR =
  '[data-ci-consent-settings], .ci-consent-settings, a[href="#ci-consent-settings"]'
export const CONSENT_SETTINGS_HASH = '#ci-consent-settings'
export const MANAGE_BUTTON_ID = 'ci-consent-manage'
const STYLE_ID = 'ci-consent-styles'

const DEFAULT_CATEGORY_TEXT: Record<ConsentCategory, { label: string; description: string }> = {
  necessary: {
    label: 'Necessary',
    description: 'Needed for the site to work and to remember your privacy choices. Always on.',
  },
  preferences: {
    label: 'Preferences',
    description: 'Remember your settings and choices, for example your chat history.',
  },
  statistics: {
    label: 'Statistics',
    description: 'Help us understand how the site is used, so we can improve it.',
  },
  marketing: {
    label: 'Marketing',
    description: 'Measure the results of our advertising and show you relevant ads.',
  },
}

const DEFAULTS: Omit<ResolvedBannerOptions, 'privacyPolicyUrl' | 'categoryText'> = {
  title: 'Help us improve your experience',
  message:
    'We use cookies and similar technologies to keep our site secure, operate essential features, analyze traffic, and improve content and advertising. Choose "Accept all" to allow all of them, or "Reject non-essential" to allow only those the site needs to work.',
  acceptLabel: 'Accept all',
  rejectLabel: 'Reject non-essential',
  privacyLinkLabel: 'Privacy policy',
  position: 'bottom',
  autoShow: true,
  injectStyles: true,
  manageButton: 'auto',
  manageLabel: 'Cookie settings',
  customizeLabel: 'Customize',
  saveLabel: 'Save choices',
  categoriesLegend: 'Choose which cookies to allow',
}

const STYLES = `
.ci-consent{position:fixed;left:0;right:0;bottom:0;z-index:var(--ci-consent-z-index,2147483000);box-sizing:border-box;padding:16px;background:var(--ci-consent-background,#fff);color:var(--ci-consent-color,#1c2430);font:var(--ci-consent-font,14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif);border-top:1px solid var(--ci-consent-border,#dde1e7);box-shadow:0 -4px 24px rgba(0,0,0,.08)}
.ci-consent--top{top:0;bottom:auto;border-top:0;border-bottom:1px solid var(--ci-consent-border,#dde1e7);box-shadow:0 4px 24px rgba(0,0,0,.08)}
.ci-consent__inner{max-width:var(--ci-consent-max-width,1100px);margin:0 auto;display:flex;flex-wrap:wrap;gap:12px 24px;align-items:center}
.ci-consent__text{flex:1 1 320px}
.ci-consent__title{margin:0 0 4px;font-size:1.05em;font-weight:600}
.ci-consent__message{margin:0}
.ci-consent__link{color:var(--ci-consent-link,#2457d6)}
.ci-consent__actions{display:flex;flex-wrap:wrap;gap:8px}
.ci-consent__button{font:inherit;cursor:pointer;min-height:40px;padding:8px 16px;border-radius:var(--ci-consent-radius,6px);border:1px solid var(--ci-consent-button-border,#2457d6);background:var(--ci-consent-button-background,#2457d6);color:var(--ci-consent-button-color,#fff)}
.ci-consent__categories{flex:1 1 100%;margin:4px 0 0;padding:12px 0 0;border:0;border-top:1px solid var(--ci-consent-border,#dde1e7)}
.ci-consent__categories legend{font-weight:600;padding:0 0 8px}
.ci-consent__category{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;align-items:start;margin:0 0 10px}
.ci-consent__category input{margin:3px 0 0;width:18px;height:18px}
.ci-consent__category label{font-weight:600}
.ci-consent__category p{grid-column:2;margin:0;opacity:.85}
.ci-consent-manage{position:fixed;left:16px;bottom:16px;z-index:var(--ci-consent-z-index,2147483000);font:var(--ci-consent-font,13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif);cursor:pointer;padding:6px 12px;border-radius:999px;border:1px solid var(--ci-consent-border,#dde1e7);background:var(--ci-consent-background,#fff);color:var(--ci-consent-color,#1c2430);box-shadow:0 2px 10px rgba(0,0,0,.12)}
.ci-consent-manage[hidden]{display:none!important}
.ci-consent__button:focus-visible,.ci-consent-manage:focus-visible,.ci-consent__link:focus-visible{outline:3px solid var(--ci-consent-focus,#ffbf47);outline-offset:2px}
`

/** Only http(s) URLs are accepted for the privacy link; anything else falls back to /privacy. */
export function resolvePrivacyPolicyUrl(explicit?: string, websiteBaseUrl?: string): string {
  const base = typeof window !== 'undefined' ? window.location.origin : undefined
  const safe = (value: string, relativeTo?: string) => {
    try {
      const url = relativeTo ? new URL(value, relativeTo) : new URL(value, base)
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
    } catch {
      return null
    }
  }
  if (explicit?.trim()) return safe(explicit.trim()) ?? '/privacy'
  if (websiteBaseUrl?.trim()) {
    const root = safe(websiteBaseUrl.trim())
    if (root) return safe('privacy', root.endsWith('/') ? root : `${root}/`) ?? '/privacy'
  }
  return '/privacy'
}

export function resolveBannerOptions(
  options: BannerOptions | undefined,
  websiteBaseUrl?: string,
): ResolvedBannerOptions {
  const merged = { ...DEFAULTS }
  for (const [key, value] of Object.entries(options ?? {})) {
    if (value === undefined || value === null) continue
    if (key === 'privacyPolicyUrl' || key === 'categoryText') continue
    ;(merged as any)[key] = value
  }
  const categoryText = { ...DEFAULT_CATEGORY_TEXT }
  for (const category of Object.keys(categoryText) as ConsentCategory[]) {
    categoryText[category] = {
      ...categoryText[category],
      ...options?.categoryText?.[category],
    }
  }
  return {
    ...merged,
    categoryText,
    privacyPolicyUrl: resolvePrivacyPolicyUrl(options?.privacyPolicyUrl, websiteBaseUrl),
  }
}

function injectStyles(options: ResolvedBannerOptions): void {
  if (!options.injectStyles || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLES
  document.head.appendChild(style)
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value)
  if (text !== undefined) el.textContent = text
  return el
}

let restoreFocusTo: HTMLElement | null = null

export function isBannerVisible(): boolean {
  return typeof document !== 'undefined' && document.getElementById(BANNER_ID) !== null
}

/**
 * Show the banner (no-op if already shown). `focus`: move keyboard focus into the banner,
 * for when the visitor opened it themselves; it is not moved when shown on page load.
 */
export interface BannerHandlers {
  onAccept: () => void
  onReject: () => void
  /** 'categories' mode: the visitor saved a choice per category. */
  onSave?: (choices: Partial<CategoryChoices>) => void
}

export interface ShowBannerOptions {
  /** Move keyboard focus into the banner (when the visitor opened it themselves). */
  focus?: boolean
  /** Where focus returns after a decision (default: the element focused when opened). */
  returnFocusTo?: HTMLElement | null
  /** 'categories' mode: offered categories, current choices, and whether to open them. */
  categories?: {
    offered: OptionalCategory[]
    current: CategoryState
    expanded?: boolean
  }
}

/**
 * Show the banner (no-op if already shown). With `focus`, keyboard focus moves into the
 * banner (the visitor opened it themselves); on page load it does not.
 */
export function showBanner(
  options: ResolvedBannerOptions,
  handlers: BannerHandlers,
  { focus = false, returnFocusTo, categories }: ShowBannerOptions = {},
): void {
  if (typeof document === 'undefined' || !document.body || isBannerVisible()) return
  injectStyles(options)

  const banner = element('section', {
    id: BANNER_ID,
    class: `ci-consent${options.position === 'top' ? ' ci-consent--top' : ''}`,
    'aria-labelledby': 'ci-consent-title',
    'aria-describedby': 'ci-consent-message',
  })
  const inner = element('div', { class: 'ci-consent__inner' })
  const text = element('div', { class: 'ci-consent__text' })
  const title = element('h2', { id: 'ci-consent-title', class: 'ci-consent__title' }, options.title)
  const message = element(
    'p',
    { id: 'ci-consent-message', class: 'ci-consent__message' },
    options.message,
  )
  const link = element(
    'a',
    { class: 'ci-consent__link', href: options.privacyPolicyUrl },
    options.privacyLinkLabel,
  )
  message.append(' ', link)
  text.append(title, message)

  // Same element, class and styling for every choice: none is more prominent.
  const button = (id: string, label: string, extra: Record<string, string> = {}) =>
    element('button', { id, type: 'button', class: 'ci-consent__button', ...extra }, label)
  const actions = element('div', { class: 'ci-consent__actions' })
  const reject = button('ci-consent-reject', options.rejectLabel)
  const accept = button('ci-consent-accept', options.acceptLabel)

  let panel: HTMLFieldSetElement | null = null
  let customize: HTMLButtonElement | null = null
  const checkboxes = new Map<OptionalCategory, HTMLInputElement>()

  if (categories) {
    panel = element('fieldset', {
      id: 'ci-consent-categories',
      class: 'ci-consent__categories',
    }) as HTMLFieldSetElement
    panel.append(element('legend', {}, options.categoriesLegend))

    const row = (category: ConsentCategory, checked: boolean, disabled: boolean) => {
      const id = `ci-consent-category-${category}`
      const wrapper = element('div', { class: 'ci-consent__category' })
      const input = element('input', {
        id,
        type: 'checkbox',
        name: category,
        'aria-describedby': `${id}-description`,
      })
      input.checked = checked
      input.disabled = disabled
      wrapper.append(
        input,
        element('label', { for: id }, options.categoryText[category].label),
        element('p', { id: `${id}-description` }, options.categoryText[category].description),
      )
      panel!.append(wrapper)
      return input
    }
    row('necessary', true, true)
    for (const category of categories.offered) {
      // Never pre-ticked (GDPR Recital 32, CJEU Planet49): only an earlier explicit choice
      // is shown as checked.
      checkboxes.set(category, row(category, categories.current[category] === true, false))
    }
    const save = button('ci-consent-save', options.saveLabel)
    panel.append(save)
    panel.hidden = !categories.expanded

    customize = button('ci-consent-customize', options.customizeLabel, {
      'aria-expanded': String(!panel.hidden),
      'aria-controls': 'ci-consent-categories',
    })
    customize.addEventListener('click', () => {
      panel!.hidden = !panel!.hidden
      customize!.setAttribute('aria-expanded', String(!panel!.hidden))
      if (!panel!.hidden) checkboxes.values().next().value?.focus()
    })
    save.addEventListener(
      'click',
      decide(() =>
        handlers.onSave?.(
          Object.fromEntries([...checkboxes].map(([category, input]) => [category, input.checked])),
        ),
      ),
    )
  }

  actions.append(...[reject, customize, accept].filter((b): b is HTMLButtonElement => !!b))
  inner.append(text, actions)
  if (panel) inner.append(panel)
  banner.append(inner)

  function decide(handler: () => void) {
    return () => {
      const hadFocus = banner.contains(document.activeElement)
      hideBanner()
      handler()
      // Return focus to where the visitor opened the banner from (e.g. "Cookie settings").
      if (hadFocus && restoreFocusTo?.isConnected && !restoreFocusTo.hidden) restoreFocusTo.focus()
      restoreFocusTo = null
    }
  }
  accept.addEventListener('click', decide(handlers.onAccept))
  reject.addEventListener('click', decide(handlers.onReject))

  document.body.appendChild(banner)
  if (focus) {
    restoreFocusTo =
      returnFocusTo ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    const firstChoice = panel && !panel.hidden ? checkboxes.values().next().value : undefined
    ;(firstChoice ?? reject).focus()
  }
}

export function hideBanner(): void {
  if (typeof document === 'undefined') return
  document.getElementById(BANNER_ID)?.remove()
}

/** Show the "Cookie settings" button (created once; hidden rather than removed). */
export function showManageButton(options: ResolvedBannerOptions, onClick: () => void): void {
  if (typeof document === 'undefined' || !document.body) return
  const existing = document.getElementById(MANAGE_BUTTON_ID)
  if (existing) {
    existing.hidden = false
    return
  }
  injectStyles(options)
  const button = element(
    'button',
    { id: MANAGE_BUTTON_ID, type: 'button', class: 'ci-consent-manage' },
    options.manageLabel,
  )
  button.addEventListener('click', onClick)
  document.body.appendChild(button)
}

export function hideManageButton(): void {
  if (typeof document === 'undefined') return
  const button = document.getElementById(MANAGE_BUTTON_ID)
  if (button) button.hidden = true
}

/** Remove the banner and the settings button (stopAutoTracking/teardown, tests). */
export function removeConsentUi(): void {
  hideBanner()
  if (typeof document !== 'undefined') document.getElementById(MANAGE_BUTTON_ID)?.remove()
}
