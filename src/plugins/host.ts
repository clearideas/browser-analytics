// Runs plugins under the consent rules. Plugins are created and loaded the first time
// they are allowed; events are forwarded only while allowed; consent changes are
// announced; vendor cookies and storage are deleted when consent is withdrawn or refused;
// a withdrawal that a running vendor cannot apply in place asks for a page reload.
import type { ConsentCategory } from '../categories'
import { UNDECIDED } from '../categories'
import type { AnalyticsConfig } from '../types'
import { debugLog } from '../types'
import { deleteCookies, deleteStorageKeys, loadScript, loadStylesheet } from './dom'
import type {
  AnalyticsPlugin,
  ConsentState,
  CookieRule,
  PluginConsentState,
  PluginContext,
  PluginEvent,
  PluginSpec,
  StorageRule,
} from './types'
import { allowedCategories, isCategoryAllowed, removedCategories } from './types'

const MAX_BUFFERED_EVENTS = 50

interface Entry {
  spec: PluginSpec
  plugin: AnalyticsPlugin | null
  status: 'idle' | 'loading' | 'loaded' | 'failed'
  allowed: boolean
  buffer: PluginEvent[]
  /** Consent state last announced to the plugin (JSON). */
  announced: string | null
  /** The last page_view delivered to the plugin. */
  seenPageView: PluginEvent | null
}

const isCategorized = (
  rule: CookieRule | StorageRule,
): rule is { name: string | RegExp; category: ConsentCategory } =>
  typeof rule === 'object' && !(rule instanceof RegExp)

// Name patterns of the cookies/storage keys that belong to the given categories.
function namesOf(
  rules: Array<CookieRule | StorageRule>,
  categories: ConsentCategory[],
  fallback: ConsentCategory,
) {
  return rules
    .filter(rule => categories.includes(isCategorized(rule) ? rule.category : fallback))
    .map(rule => (isCategorized(rule) ? rule.name : rule))
}

export class PluginHost {
  private readonly config: AnalyticsConfig
  private readonly entries: Entry[]
  private state: ConsentState | null = null
  private lastPageView: PluginEvent | null = null
  private reloadRequested = false

  constructor(config: AnalyticsConfig, specs: PluginSpec[]) {
    this.config = config
    const seen = new Set<string>()
    this.entries = []
    for (const spec of specs) {
      if (seen.has(spec.name)) {
        debugLog(config, 'Duplicate plugin ignored', { name: spec.name })
        continue
      }
      seen.add(spec.name)
      this.entries.push({
        spec,
        plugin: null,
        status: 'idle',
        allowed: false,
        buffer: [],
        announced: null,
        seenPageView: null,
      })
    }
  }

  get pluginNames(): string[] {
    return this.entries.map(entry => entry.spec.name)
  }

  /** Status of each plugin (for diagnostics and tests). */
  status(): Record<string, { status: Entry['status']; allowed: boolean }> {
    return Object.fromEntries(
      this.entries.map(entry => [
        entry.spec.name,
        { status: entry.status, allowed: entry.allowed },
      ]),
    )
  }

  /**
   * Apply the current consent state. Synchronous: every decision takes effect before any
   * later event is forwarded (events for plugins still loading are buffered in order).
   */
  applyConsent(state: ConsentState): void {
    const changed = JSON.stringify(state) !== JSON.stringify(this.state)
    const previous = this.state
    this.state = { ...state }
    if (!changed) return

    // Remove vendor data of categories withdrawn or refused, for every configured plugin
    // (a vendor may have set it on an earlier visit, or through a tag on the page).
    const removed = removedCategories(previous, state)
    for (const entry of this.entries) {
      const wasAllowed = entry.allowed
      entry.allowed = isCategoryAllowed(entry.spec.category, state)
      if (wasAllowed && !entry.allowed) {
        entry.buffer = []
        // Vendor code already running that cannot be told to stop: reload the page.
        if (entry.status !== 'idle' && (entry.spec.withdrawal ?? 'stop') === 'reload') {
          this.reloadRequested = true
          debugLog(this.config, 'Withdrawal needs a page reload', { plugin: entry.spec.name })
        }
      }

      if (removed.length) this.removeVendorData(entry, removed)

      if ((entry.allowed || entry.spec.loadWithoutConsent) && entry.status === 'idle') {
        void this.load(entry)
      } else if (entry.status === 'loaded') {
        this.announce(entry)
        // A plugin that was already loaded (a bridge to a page-installed tag) and is now
        // allowed catches up with the page being viewed, like a freshly loaded plugin.
        if (!wasAllowed && entry.allowed) this.catchUp(entry)
      }
    }
  }

  /**
   * Whether a withdrawal since the last call needs a page reload (a running vendor that
   * cannot be stopped in place). Reading it clears it.
   */
  takeReloadRequest(): boolean {
    const requested = this.reloadRequested
    this.reloadRequested = false
    return requested
  }

  private removeVendorData(entry: Entry, categories: ConsentCategory[]): void {
    const { cookies = [], storage = [], category } = entry.spec
    const deletedCookies = deleteCookies(namesOf(cookies, categories, category))
    const deletedKeys = deleteStorageKeys(namesOf(storage, categories, category))
    if (deletedCookies.length || deletedKeys.length) {
      debugLog(this.config, 'Deleted vendor data', {
        plugin: entry.spec.name,
        cookies: deletedCookies,
        storage: deletedKeys,
      })
    }
  }

  /** Forward an event to every plugin allowed to receive it. */
  track(event: PluginEvent): void {
    if (event.name === 'page_view') this.lastPageView = event
    for (const entry of this.entries) {
      if (!entry.allowed) continue
      if (entry.status === 'loaded') this.deliver(entry, event)
      else if (entry.status === 'loading' && entry.buffer.length < MAX_BUFFERED_EVENTS) {
        entry.buffer.push(event)
      }
    }
  }

  /** Resolves when no plugin is loading (tests, diagnostics). */
  async idle(): Promise<void> {
    for (let i = 0; i < 50 && this.entries.some(e => e.status === 'loading'); i++) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }

  private context(entry: Entry): PluginContext {
    return {
      config: this.config,
      consent: () => this.consentFor(entry),
      debug: (message, data) => debugLog(this.config, `[${entry.spec.name}] ${message}`, data),
      loadScript,
      loadStylesheet,
    }
  }

  private consentFor(entry: Entry): PluginConsentState {
    const state = this.state ?? {
      required: true,
      granted: null,
      gpc: false,
      categories: { ...UNDECIDED },
    }
    return { ...state, allowed: entry.allowed, allowedCategories: allowedCategories(state) }
  }

  private async load(entry: Entry): Promise<void> {
    entry.status = 'loading'
    // The page being viewed when the plugin became allowed (e.g. the page where the
    // visitor accepted): replayed once loaded so the plugin sees the current page.
    const replay = this.lastPageView
    try {
      const plugin = await entry.spec.create()
      entry.plugin = plugin
      await plugin.load?.(this.context(entry))
      entry.status = 'loaded'
      debugLog(this.config, 'Plugin loaded', { plugin: entry.spec.name })
    } catch (error) {
      entry.status = 'failed'
      entry.buffer = []
      console.warn(`[Analytics] Plugin "${entry.spec.name}" failed to load`)
      debugLog(this.config, 'Plugin failed to load', {
        plugin: entry.spec.name,
        error: error instanceof Error ? error.message : String(error),
      })
      return
    }

    // Consent may have changed while loading.
    this.announce(entry)
    const buffered = entry.buffer
    entry.buffer = []
    if (!entry.allowed) return
    if (replay && !buffered.includes(replay)) this.deliver(entry, replay)
    for (const event of buffered) this.deliver(entry, event)
  }

  private catchUp(entry: Entry): void {
    if (this.lastPageView && entry.seenPageView !== this.lastPageView) {
      this.deliver(entry, this.lastPageView)
    }
  }

  private announce(entry: Entry): void {
    if (!entry.plugin) return
    const state = this.consentFor(entry)
    const key = JSON.stringify(state)
    if (key === entry.announced) return
    entry.announced = key
    try {
      entry.plugin.consentChanged?.(state, this.context(entry))
    } catch (error) {
      debugLog(this.config, 'Plugin consentChanged failed', { plugin: entry.spec.name, error })
    }
  }

  private deliver(entry: Entry, event: PluginEvent): void {
    if (event.name === 'page_view') entry.seenPageView = event
    try {
      entry.plugin?.track?.(event, this.context(entry))
    } catch (error) {
      debugLog(this.config, 'Plugin track failed', { plugin: entry.spec.name, error })
    }
  }
}
