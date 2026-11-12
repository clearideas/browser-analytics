import { beforeEach, describe, expect, it, vi } from 'vitest'

import { consentState, makeConfig, pluginState } from '../../test/helpers'
import {
  CHAT_WIDGET_READY_EVENT,
  clearIdeasChat,
  DEFAULT_CHAT_WIDGET_CSS_URL,
  DEFAULT_CHAT_WIDGET_URL,
} from './clearideas-chat'
import { resetLoadedResources } from './dom'
import type { PluginConsentState, PluginContext } from './types'

const UNDECIDED: PluginConsentState = pluginState(consentState(), 'necessary')
const GRANTED: PluginConsentState = pluginState(consentState({ decision: true }), 'necessary')

function fakeWidget() {
  const calls: unknown[][] = []
  const instance = {
    setConsentRequired: (value: boolean) => calls.push(['required', value]),
    setConsentGranted: (value: boolean) => calls.push(['granted', value]),
  }
  const init = vi.fn(() => instance as any)
  window.ClearIdeasWidget = { init }
  return { init, calls }
}

function context(state = UNDECIDED): PluginContext {
  return {
    config: makeConfig(),
    consent: () => state,
    debug: () => {},
    loadScript: vi.fn(async () => {}),
    loadStylesheet: vi.fn(async () => {}),
  }
}

beforeEach(() => {
  resetLoadedResources()
  delete window.ClearIdeasWidget
  delete window.clearIdeasWidget
})

describe('clearIdeasChat plugin', () => {
  it('announces lazy widget readiness after the instance is available', async () => {
    const listener = vi.fn(() => expect(window.clearIdeasWidget).toBeDefined())
    window.addEventListener(CHAT_WIDGET_READY_EVENT, listener, { once: true })
    fakeWidget()
    await clearIdeasChat({ accessKey: 'widget_key' }).load!(context())
    expect(listener).toHaveBeenCalledOnce()
  })
  it('is functional by default (runs without analytics consent); can require consent', () => {
    expect(clearIdeasChat({ accessKey: 'k' }).category).toBe('necessary')
    expect(clearIdeasChat({ accessKey: 'k', requiresConsent: true }).category).toBe('preferences')
  })

  it('loads the stylesheet and script (with optional SRI) and initializes the widget', async () => {
    const ctx = context()
    ;(ctx.loadScript as any).mockImplementation(async () => fakeWidget())

    await clearIdeasChat({
      accessKey: 'widget_key',
      widgetUrl: 'https://updates.clearideas.com/v1.2.3/chat.js',
      integrity: 'sha384-js',
      cssIntegrity: 'sha384-css',
      position: 'bottom-left',
      darkMode: true,
      userEmail: '',
    }).load!(ctx)

    expect(ctx.loadStylesheet).toHaveBeenCalledWith(DEFAULT_CHAT_WIDGET_CSS_URL, {
      integrity: 'sha384-css',
    })
    expect(ctx.loadScript).toHaveBeenCalledWith('https://updates.clearideas.com/v1.2.3/chat.js', {
      integrity: 'sha384-js',
    })
    const config = (window.ClearIdeasWidget!.init as any).mock.calls[0][0]
    expect(config).toEqual({
      accessKey: 'widget_key',
      darkMode: true,
      hasConsent: true,
      consentRequired: true,
      consentGranted: false,
      position: 'bottom-left',
    })
    expect(window.clearIdeasWidget).toBeDefined()
  })

  it('uses the default widget URL and skips loading when the widget script is already present', async () => {
    const ctx = context()
    fakeWidget()

    await clearIdeasChat({ accessKey: 'k' }).load!(ctx)

    expect(ctx.loadScript).not.toHaveBeenCalled()
    expect(DEFAULT_CHAT_WIDGET_URL).toBe('https://updates.clearideas.com/chat.js')
  })

  it('passes consent changes to the widget, honoring explicit overrides', async () => {
    const widget = fakeWidget()
    const plugin = clearIdeasChat({ accessKey: 'k' })
    await plugin.load!(context())

    plugin.consentChanged!(GRANTED, context(GRANTED))

    expect(widget.calls).toEqual([
      ['required', true],
      ['granted', true],
    ])

    const overridden = fakeWidget()
    delete window.clearIdeasWidget
    const fixed = clearIdeasChat({ accessKey: 'k', consentRequired: false })
    await fixed.load!(context())
    fixed.consentChanged!(GRANTED, context(GRANTED))
    expect(overridden.calls[0]).toEqual(['required', false])
  })

  it('does not initialize twice', async () => {
    const widget = fakeWidget()
    await clearIdeasChat({ accessKey: 'k' }).load!(context())
    await clearIdeasChat({ accessKey: 'k' }).load!(context())
    expect(widget.init).toHaveBeenCalledTimes(1)
  })
})
