// Script-tag build only (replaces loaders.ts): each built-in plugin is a separate file next
// to analytics.js (script-plugins/<name>.<hash>.js), downloaded only when the plugin is
// configured and allowed. Files are loaded with Subresource Integrity using hashes built
// into analytics.js, so pinning analytics.js (with its own integrity attribute) also pins
// every plugin it can load.
import { loadScript } from './dom'
import type { BuiltInPluginName, PluginFactory, PluginLoaders } from './loader-types'
import { BUILT_IN_PLUGINS } from './loader-types'

export type { BuiltInPluginName, PluginFactory, PluginLoaders } from './loader-types'

/** Plugin name -> [file name, integrity]. Filled in by the build (rollup.config.js). */
declare const __CI_PLUGIN_FILES__: Record<string, [string, string]>

declare global {
  interface Window {
    /** Where plugin files register their factory (script-tag build only). */
    __ciAnalyticsPlugins?: Record<string, PluginFactory>
  }
}

// The URL analytics.js was loaded from, read while it runs. A data-plugin-base-url
// attribute on the script tag overrides where plugin files are fetched from.
const loader =
  typeof document !== 'undefined' ? (document.currentScript as HTMLScriptElement | null) : null
const defaultBase = loader?.dataset.pluginBaseUrl || loader?.src || undefined

export function remoteLoaders(
  files: Record<string, [string, string]>,
  base: string | undefined,
): PluginLoaders {
  const load = async (name: BuiltInPluginName): Promise<PluginFactory> => {
    const file = files[name]
    if (!file) throw new Error(`No plugin file for ${name}`)
    if (!base) throw new Error('Cannot locate plugin files: analytics.js URL unknown')
    if (!window.__ciAnalyticsPlugins?.[name]) {
      const [fileName, integrity] = file
      await loadScript(new URL(`script-plugins/${fileName}`, base).href, { integrity })
    }
    const factory = window.__ciAnalyticsPlugins?.[name]
    if (typeof factory !== 'function') throw new Error(`Plugin file for ${name} did not register`)
    return factory
  }
  return Object.fromEntries(BUILT_IN_PLUGINS.map(name => [name, () => load(name)])) as PluginLoaders
}

export const pluginLoaders: PluginLoaders = remoteLoaders(
  typeof __CI_PLUGIN_FILES__ === 'undefined' ? {} : __CI_PLUGIN_FILES__,
  defaultBase,
)
