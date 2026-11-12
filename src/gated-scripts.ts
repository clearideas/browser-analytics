// Consent-gated <script> tags, for tools without a plugin:
//
//   <script type="text/plain" data-ci-consent="marketing" src="https://vendor.example/tag.js"></script>
//
// Browsers neither download nor run a script whose type is text/plain. Once the category
// is allowed, a live copy is inserted after the inert element (the element itself is left
// in place, so frameworks that render it are not disturbed). Copies are inserted in
// document order; an external script finishes loading before the next one runs, so an
// inline snippet can depend on the library above it.
//
// The library only decides when such a script starts. It does not see or control what the
// script does afterwards. When its category is withdrawn, the cookies and storage keys the
// site lists (data-ci-cookies, data-ci-storage) are deleted and the page is reloaded, so
// the script no longer runs (see consent.reloadOnWithdrawal).
//
// Security: pages with a 'strict-dynamic' Content Security Policy trust scripts created by
// trusted scripts. Activating any inert script would let injected HTML run code, so when
// a page uses CSP nonces, only elements carrying the page's nonce are activated.
import type { ConsentCategory } from './categories'
import { isOptionalCategory } from './categories'
import { deleteCookies, deleteStorageKeys } from './plugins/dom'
import type { ConsentState } from './plugins/types'
import { isCategoryAllowed, removedCategories } from './plugins/types'
import type { AnalyticsConfig } from './types'
import { debugLog } from './types'

export interface GatedScriptsOptions {
  /**
   * The page's CSP nonce. Gated scripts must carry it to be activated, and their live
   * copies get it. Default: the nonce of the script element that loaded this library
   * (script tag or classic bundle), if any.
   */
  nonce?: string
  /**
   * Activate only scripts carrying the nonce, even if the page seems not to use nonces.
   * For pages whose CSP uses hashes with 'strict-dynamic'. Default false.
   */
  requireNonce?: boolean
  /** Activate external gated scripts only from these origins (e.g. ['https://js.hs-scripts.com']). */
  allowedOrigins?: string[]
}

export const GATED_SELECTOR = 'script[type="text/plain"][data-ci-consent]'
const ACTIVATED = 'data-ci-activated'
const LOAD_TIMEOUT_MS = 10_000

// Nonce of the script that is loading this library, read while it runs (classic scripts
// only; module scripts have no currentScript).
const loaderNonce =
  typeof document !== 'undefined'
    ? (document.currentScript as HTMLScriptElement | null)?.nonce || undefined
    : undefined

const nonceOf = (el: Element) => (el as HTMLElement).nonce || el.getAttribute('nonce') || ''

const patterns = (value: string | null) =>
  (value ?? '')
    .split(/[\s,]+/)
    .map(part => part.trim())
    .filter(Boolean)

export class GatedScripts {
  private readonly config: AnalyticsConfig
  private readonly options: GatedScriptsOptions
  private state: ConsentState | null = null
  private chain: Promise<void> = Promise.resolve()
  private observer: MutationObserver | null = null
  private readonly activated = new Set<ConsentCategory>()
  private reloadRequested = false
  private warnedNonce = false

  constructor(config: AnalyticsConfig, options: GatedScriptsOptions = {}) {
    this.config = config
    this.options = options
  }

  /** Apply a consent state: clean up refused categories and activate allowed scripts. */
  apply(state: ConsentState): void {
    if (typeof document === 'undefined') return
    const previous = this.state
    // Called for every event: nothing to do unless the consent state changed.
    if (previous && JSON.stringify(previous) === JSON.stringify(state)) return
    this.state = { ...state }

    const removed = removedCategories(previous, state)
    if (removed.length) this.removeData(removed)
    for (const category of removed) {
      if (this.activated.has(category)) {
        this.activated.delete(category)
        this.reloadRequested = true
        debugLog(this.config, 'Withdrawal needs a page reload (gated scripts ran)', { category })
      }
    }

    this.activateAllowed(document)
    this.observe()
  }

  /** Whether a withdrawal since the last call needs a page reload. Reading it clears it. */
  takeReloadRequest(): boolean {
    const requested = this.reloadRequested
    this.reloadRequested = false
    return requested
  }

  /** Resolves when every activation started so far has finished (tests, diagnostics). */
  idle(): Promise<void> {
    return this.chain
  }

  stop(): void {
    this.observer?.disconnect()
    this.observer = null
  }

  private categoryOf(el: Element): ConsentCategory | null {
    const value = el.getAttribute('data-ci-consent')?.trim() ?? ''
    if (value === 'necessary' || isOptionalCategory(value)) return value
    debugLog(this.config, 'Gated script with an unknown category is never activated', { value })
    return null
  }

  private activateAllowed(root: ParentNode): void {
    if (!this.state) return
    const candidates: Element[] = []
    if (root instanceof Element && root.matches(GATED_SELECTOR)) candidates.push(root)
    candidates.push(...Array.from(root.querySelectorAll(GATED_SELECTOR)))
    for (const el of candidates) {
      if (el.hasAttribute(ACTIVATED)) continue
      const category = this.categoryOf(el)
      if (!category || !isCategoryAllowed(category, this.state)) continue
      if (!this.trusted(el as HTMLScriptElement)) continue
      // Marked now so it is queued once, even if scanned again before it runs.
      el.setAttribute(ACTIVATED, '')
      this.activated.add(category)
      this.chain = this.chain.then(() => this.activate(el as HTMLScriptElement))
    }
  }

  // Whether this element may be turned into a running script (see Security above).
  private trusted(el: HTMLScriptElement): boolean {
    const expected = this.options.nonce || loaderNonce
    if (expected) {
      if (nonceOf(el) !== expected) {
        debugLog(this.config, 'Gated script without the page nonce is not activated', {
          src: el.getAttribute('src'),
        })
        return false
      }
    } else if (this.options.requireNonce || document.querySelector('script[nonce]')) {
      if (!this.warnedNonce) {
        this.warnedNonce = true
        console.warn(
          '[Analytics] This page uses CSP nonces: set gatedScripts.nonce (or put the nonce on the analytics script tag) to activate consent-gated scripts.',
        )
      }
      return false
    }

    const src = el.getAttribute('src')
    const allowedOrigins = this.options.allowedOrigins
    if (src && allowedOrigins) {
      let origin = ''
      try {
        origin = new URL(src, document.baseURI).origin
      } catch {
        // invalid URL: not allowed
      }
      if (!allowedOrigins.includes(origin)) {
        debugLog(this.config, 'Gated script origin not in gatedScripts.allowedOrigins', { src })
        return false
      }
    }
    return true
  }

  private activate(el: HTMLScriptElement): Promise<void> {
    if (!el.isConnected) return Promise.resolve()
    const script = document.createElement('script')
    for (const attribute of Array.from(el.attributes)) {
      const name = attribute.name
      if (name === 'type' || name === 'nonce' || name === 'id' || name.startsWith('data-ci-'))
        continue
      script.setAttribute(name, attribute.value)
    }
    // The id moves to the live script (vendor code may look itself up by id).
    if (el.id) {
      script.id = el.id
      el.removeAttribute('id')
    }
    const type = el.getAttribute('data-ci-type')
    if (type) script.type = type
    const nonce = this.options.nonce || loaderNonce
    if (nonce) script.nonce = nonce

    const external = el.hasAttribute('src')
    if (!external) script.text = el.text
    // Dynamically inserted scripts are async by default; keep document order unless the
    // original asked for async.
    else if (!el.hasAttribute('async')) script.async = false

    const loaded =
      external && !script.async
        ? new Promise<void>(resolve => {
            const done = () => {
              clearTimeout(timer)
              resolve()
            }
            const timer = setTimeout(done, LOAD_TIMEOUT_MS)
            script.addEventListener('load', done, { once: true })
            script.addEventListener('error', done, { once: true })
          })
        : Promise.resolve()

    el.after(script)
    debugLog(this.config, 'Gated script activated', {
      category: el.getAttribute('data-ci-consent'),
      src: el.getAttribute('src') ?? '(inline)',
    })
    return loaded
  }

  // Delete the cookies and storage keys gated scripts of these categories declare.
  private removeData(categories: ConsentCategory[]): void {
    const cookies: string[] = []
    const storage: string[] = []
    for (const el of Array.from(document.querySelectorAll('[data-ci-consent]'))) {
      if (el.tagName !== 'SCRIPT') continue
      const category = el.getAttribute('data-ci-consent')?.trim()
      if (!category || !categories.includes(category as ConsentCategory)) continue
      cookies.push(...patterns(el.getAttribute('data-ci-cookies')))
      storage.push(...patterns(el.getAttribute('data-ci-storage')))
    }
    const deletedCookies = deleteCookies(cookies)
    const deletedKeys = deleteStorageKeys(storage)
    if (deletedCookies.length || deletedKeys.length) {
      debugLog(this.config, 'Deleted data of gated scripts', {
        cookies: deletedCookies,
        storage: deletedKeys,
      })
    }
  }

  // Scripts added later (single-page apps rendering new content).
  private observe(): void {
    if (this.observer || typeof MutationObserver === 'undefined' || !document.documentElement)
      return
    this.observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (node instanceof Element) this.activateAllowed(node)
        }
      }
    })
    this.observer.observe(document.documentElement, { childList: true, subtree: true })
  }
}
