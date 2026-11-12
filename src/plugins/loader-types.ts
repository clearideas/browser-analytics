import type { AnalyticsPlugin } from './types'

export const BUILT_IN_PLUGINS = [
  'googleAnalytics',
  'microsoftUet',
  'openAIAds',
  'clearIdeasChat',
  'hubspot',
  'intercom',
  'metaPixel',
  'linkedInInsight',
  'microsoftClarity',
  'hotjar',
] as const

export type BuiltInPluginName = (typeof BUILT_IN_PLUGINS)[number]

/** A built-in plugin's factory, e.g. hubspot(options). */
export type PluginFactory = (options: any) => AnalyticsPlugin

export type PluginLoaders = Record<BuiltInPluginName, () => Promise<PluginFactory>>
