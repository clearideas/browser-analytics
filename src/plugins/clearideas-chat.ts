// Clear Ideas Chat widget.
import type { AnalyticsPlugin, PluginConsentState, PluginContext } from './types'

export const DEFAULT_CHAT_WIDGET_URL = 'https://updates.clearideas.com/chat.js'
export const DEFAULT_CHAT_WIDGET_CSS_URL = 'https://updates.clearideas.com/chat.css'
export const CHAT_WIDGET_READY_EVENT = 'clearideas-chat-ready'

type Position = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'

export interface ClearIdeasChatOptions {
  /** Public widget access key (required). */
  accessKey: string
  /** Chat API base URL (default: the widget's own default). */
  apiBaseUrl?: string
  /**
   * Widget script URL. Prefer a versioned URL (".../v1.2.3/chat.js") together with
   * `integrity`, so a change on the CDN cannot change the code running on your site.
   */
  widgetUrl?: string
  cssUrl?: string
  /** Subresource Integrity hash of the widget script (e.g. "sha384-..."). */
  integrity?: string
  /** Subresource Integrity hash of the widget stylesheet. */
  cssIntegrity?: string
  /**
   * Chat is a functional service (customer support) and loads without analytics consent
   * by default. Set true to load it only with consent.
   */
  requiresConsent?: boolean
  openOnLoad?: boolean
  position?: Position
  width?: number
  height?: number
  top?: number
  right?: number
  bottom?: number
  left?: number
  /** Default: detected from the page (data-theme, dark classes, prefers-color-scheme). */
  darkMode?: boolean
  fabSize?: number
  fabHide?: boolean
  userName?: string
  userEmail?: string
  userId?: string
  container?: string
  /** Override the consent flags passed to the widget (default: from the analytics consent state). */
  consentRequired?: boolean
  consentGranted?: boolean
}

export interface ClearIdeasWidgetInstance {
  open: () => void
  close: () => void
  toggle: () => void
  sendMessage: (message: string) => Promise<void>
  hide: () => void
  show: () => void
  destroy: () => void
  setConsentRequired: (required: boolean) => void
  setConsentGranted: (granted: boolean) => void
  setDarkMode: (darkMode: boolean) => void
  setPosition: (position: Position) => void
  setWidth: (width: number) => void
  setHeight: (height: number) => void
  setTop: (top?: number) => void
  setRight: (right?: number) => void
  setBottom: (bottom?: number) => void
  setLeft: (left?: number) => void
  setFabSize: (size: number) => void
  setUserName: (name: string) => void
  setUserEmail: (email: string) => void
  setUserId: (id: string) => void
}

/** A bundled widget loader keeps applications independent of mutable CDN aliases. */
export type ChatWidgetLoader = () => Promise<{
  init: (config: Record<string, any>) => ClearIdeasWidgetInstance
}>
let bundledWidgetLoader: ChatWidgetLoader | null = null
export function setChatWidgetLoader(loader: ChatWidgetLoader | null): void {
  bundledWidgetLoader = loader
}

declare global {
  interface Window {
    ClearIdeasWidget?: {
      init: (config: Record<string, unknown>) => ClearIdeasWidgetInstance
    }
    /** The widget instance, as documented for sites (e.g. window.clearIdeasWidget.open()). */
    clearIdeasWidget?: ClearIdeasWidgetInstance
  }
}

/** The chat widget instance, if it has been initialized. */
export function getChatWidgetInstance(): ClearIdeasWidgetInstance | null {
  if (typeof window === 'undefined') return null
  const widget = window.clearIdeasWidget
  return widget && typeof widget.setConsentRequired === 'function' ? widget : null
}

function pageUsesDarkMode(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  const root = document.documentElement
  const body = document.body
  const theme = root.getAttribute('data-theme')
  if (theme === 'dark' || theme === 'light') return theme === 'dark'
  return (
    root.classList.contains('dark') ||
    root.classList.contains('theme-dark') ||
    root.classList.contains('v-theme--dark') ||
    body?.classList.contains('dark') ||
    body?.classList.contains('theme-dark') ||
    body?.classList.contains('v-theme--dark') ||
    document.querySelector('.v-theme--dark') !== null ||
    window.matchMedia?.('(prefers-color-scheme: dark)').matches === true
  )
}

export function clearIdeasChat(options: ClearIdeasChatOptions): AnalyticsPlugin {
  const widgetConsent = (state: PluginConsentState) => ({
    // Explicit refusal applies even in regions where an initial opt-in is optional.
    consentRequired:
      state.categories.preferences === false ? true : (options.consentRequired ?? state.required),
    // The widget's own storage (e.g. chat history) is a preference.
    consentGranted:
      state.categories.preferences === false
        ? false
        : (options.consentGranted ?? state.categories.preferences === true),
  })

  const initWidget = (ctx: PluginContext) => {
    if (!window.ClearIdeasWidget) throw new Error('ClearIdeasWidget not available after loading')
    const config: Record<string, unknown> = {
      accessKey: options.accessKey,
      darkMode: options.darkMode ?? pageUsesDarkMode(),
      // Chat availability does not depend on analytics consent; the widget uses
      // consentRequired/consentGranted for its own storage.
      hasConsent: true,
      ...widgetConsent(ctx.consent()),
    }
    const optional: Array<keyof ClearIdeasChatOptions> = [
      'apiBaseUrl',
      'openOnLoad',
      'position',
      'width',
      'height',
      'top',
      'right',
      'bottom',
      'left',
      'fabSize',
      'fabHide',
      'userName',
      'userEmail',
      'userId',
      'container',
    ]
    for (const key of optional) {
      if (options[key] !== undefined && options[key] !== '') config[key] = options[key]
    }
    window.clearIdeasWidget = window.ClearIdeasWidget.init(config)
    window.dispatchEvent(new Event(CHAT_WIDGET_READY_EVENT))
    ctx.debug('Widget initialized', { position: config.position })
  }

  return {
    name: 'clearIdeasChat',
    category: options.requiresConsent === true ? 'preferences' : 'necessary',

    async load(ctx) {
      if (typeof window === 'undefined' || !options.accessKey) return
      if (getChatWidgetInstance()) {
        ctx.debug('Widget already initialized')
        return
      }
      if (!window.ClearIdeasWidget && bundledWidgetLoader) {
        window.ClearIdeasWidget = await bundledWidgetLoader()
      } else if (!window.ClearIdeasWidget) {
        ctx
          .loadStylesheet(options.cssUrl ?? DEFAULT_CHAT_WIDGET_CSS_URL, {
            integrity: options.cssIntegrity,
          })
          .catch(() => ctx.debug('Widget stylesheet failed to load'))
        await ctx.loadScript(options.widgetUrl ?? DEFAULT_CHAT_WIDGET_URL, {
          integrity: options.integrity,
        })
      }
      initWidget(ctx)
    },

    consentChanged(state) {
      const widget = getChatWidgetInstance()
      if (!widget) return
      const { consentRequired, consentGranted } = widgetConsent(state)
      widget.setConsentRequired(consentRequired)
      widget.setConsentGranted(consentGranted)
    },
  }
}
