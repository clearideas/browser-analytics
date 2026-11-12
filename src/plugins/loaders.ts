// How built-in plugin code is fetched. In the npm build each plugin is a separate chunk
// loaded with import(). The script-tag build replaces this module with loaders.script.ts,
// which fetches plugin files next to analytics.js with Subresource Integrity.
import type { PluginFactory, PluginLoaders } from './loader-types'

export type { BuiltInPluginName, PluginFactory, PluginLoaders } from './loader-types'

const factory = <T>(load: () => Promise<T>) => load as unknown as () => Promise<PluginFactory>

export const pluginLoaders: PluginLoaders = {
  googleAnalytics: factory(() => import('./google-analytics').then(m => m.googleAnalytics)),
  microsoftUet: factory(() => import('./microsoft-uet').then(m => m.microsoftUet)),
  openAIAds: factory(() => import('./openai-ads').then(m => m.openAIAds)),
  clearIdeasChat: factory(() => import('./clearideas-chat').then(m => m.clearIdeasChat)),
  hubspot: factory(() => import('./hubspot').then(m => m.hubspot)),
  intercom: factory(() => import('./intercom').then(m => m.intercom)),
  metaPixel: factory(() => import('./meta-pixel').then(m => m.metaPixel)),
  linkedInInsight: factory(() => import('./linkedin-insight').then(m => m.linkedInInsight)),
  microsoftClarity: factory(() => import('./microsoft-clarity').then(m => m.microsoftClarity)),
  hotjar: factory(() => import('./hotjar').then(m => m.hotjar)),
}
