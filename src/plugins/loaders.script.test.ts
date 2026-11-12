// The script-tag build's plugin loader: plugin files next to analytics.js, with integrity.
import { describe, expect, it, vi } from 'vitest'

import { resetLoadedResources } from './dom'
import { remoteLoaders } from './loaders.script'

const FILES = { hubspot: ['hubspot.abc.js', 'sha384-XYZ'] as [string, string] }
const BASE = 'https://cdn.example.test/npm/@clearideas/consent-analytics@1.2.3/dist/analytics.js'

/** Pretend the downloaded file ran when its script element is added. */
function onScriptAdded(run: (script: HTMLScriptElement) => void) {
  const append = document.head.appendChild.bind(document.head)
  vi.spyOn(document.head, 'appendChild').mockImplementation(node => {
    if (node instanceof HTMLScriptElement) run(node)
    return append(node)
  })
}

describe('remoteLoaders (script-tag build)', () => {
  it('fetches the plugin file next to analytics.js with its integrity hash', async () => {
    resetLoadedResources()
    const added: HTMLScriptElement[] = []
    const factory = () => ({ name: 'hubspot' })
    onScriptAdded(script => {
      added.push(script)
      ;(window.__ciAnalyticsPlugins = window.__ciAnalyticsPlugins || {}).hubspot = factory
    })

    const loaded = await remoteLoaders(FILES, BASE).hubspot()

    expect(loaded).toBe(factory)
    expect(added[0]!.src).toBe(
      'https://cdn.example.test/npm/@clearideas/consent-analytics@1.2.3/dist/script-plugins/hubspot.abc.js',
    )
    expect(added[0]!.integrity).toBe('sha384-XYZ')
    expect(added[0]!.crossOrigin).toBe('anonymous')
  })

  it('fails (the plugin does not load) if the file does not register', async () => {
    resetLoadedResources()
    await expect(remoteLoaders(FILES, BASE).hubspot()).rejects.toThrow(/did not register/)
  })

  it('fails without a file or a base URL', async () => {
    await expect(remoteLoaders({}, BASE).hubspot()).rejects.toThrow(/No plugin file/)
    await expect(remoteLoaders(FILES, undefined).hubspot()).rejects.toThrow(/URL unknown/)
  })
})
