// Configuration -> plugin specs. Built-in integrations are loaded with import() only when
// configured and allowed, so unused integrations cost nothing.
import type { ConsentCategory } from '../categories'
import type { AnalyticsConfig } from '../types'
import type { ClearIdeasChatOptions } from './clearideas-chat'
import type { GoogleAnalyticsOptions } from './google-analytics'
import type { HotjarOptions } from './hotjar'
import type { HubSpotOptions } from './hubspot'
import type { IntercomOptions } from './intercom'
import type { LinkedInInsightOptions } from './linkedin-insight'
import type { BuiltInPluginName } from './loaders'
import { pluginLoaders } from './loaders'
import type { MetaPixelOptions } from './meta-pixel'
import type { MicrosoftClarityOptions } from './microsoft-clarity'
import type { MicrosoftUetOptions } from './microsoft-uet'
import type { OpenAIAdsOptions } from './openai-ads'
import type { CookieRule, PluginSpec, StorageRule, WithdrawalMode } from './types'
import { pluginCategory } from './types'
import {
  GOOGLE_COOKIES,
  HOTJAR_COOKIES,
  HOTJAR_STORAGE,
  HUBSPOT_COOKIES,
  INTERCOM_COOKIES,
  INTERCOM_STORAGE,
  LINKEDIN_INSIGHT_COOKIES,
  META_PIXEL_COOKIES,
  MICROSOFT_CLARITY_COOKIES,
  MICROSOFT_UET_COOKIES,
} from './vendor-cookies'

/** Built-in integrations, configured by name. `false` disables one. */
export interface IntegrationsConfig {
  googleAnalytics?: GoogleAnalyticsOptions | false
  microsoftUet?: MicrosoftUetOptions | false
  openAIAds?: OpenAIAdsOptions | false
  clearIdeasChat?: ClearIdeasChatOptions | false
  hubspot?: HubSpotOptions | false
  intercom?: IntercomOptions | false
  metaPixel?: MetaPixelOptions | false
  linkedInInsight?: LinkedInInsightOptions | false
  microsoftClarity?: MicrosoftClarityOptions | false
  hotjar?: HotjarOptions | false
}

const hasEntries = (value?: Record<string, unknown>) => !!value && Object.keys(value).length > 0

/**
 * The pre-plugin flat settings (gaMeasurementId, microsoftAdsTagId, openAIAdsPixelId,
 * chat*) mapped to integrations with their previous behavior: Google and Microsoft tags
 * installed by the page itself, and every event forwarded.
 */
export function legacyIntegrations(config: AnalyticsConfig): IntegrationsConfig {
  const integrations: IntegrationsConfig = {}

  if (config.gaMeasurementId || hasEntries(config.googleAdsConversions)) {
    integrations.googleAnalytics = {
      measurementId: config.gaMeasurementId,
      adsConversions: config.googleAdsConversions,
      loadScript: false,
      events: 'all',
    }
  }
  if (config.microsoftAdsTagId || hasEntries(config.microsoftAdsGoals)) {
    integrations.microsoftUet = {
      tagId: config.microsoftAdsTagId,
      goals: config.microsoftAdsGoals,
      loadScript: false,
      events: 'all',
    }
  }
  if (config.openAIAdsPixelId) {
    integrations.openAIAds = {
      pixelId: config.openAIAdsPixelId,
      events: config.openAIAdsEvents,
      debug: config.openAIAdsDebug,
    }
  }
  if (config.chatAccessKey && config.chatEnabled !== false) {
    integrations.clearIdeasChat = {
      accessKey: config.chatAccessKey,
      apiBaseUrl: config.chatApiBaseUrl,
      widgetUrl: config.chatWidgetUrl,
      cssUrl: config.chatWidgetCssUrl,
      openOnLoad: config.chatOpenOnLoad,
      position: config.chatPosition,
      width: config.chatWidth,
      height: config.chatHeight,
      top: config.chatTop,
      right: config.chatRight,
      bottom: config.chatBottom,
      left: config.chatLeft,
      darkMode: config.chatDarkMode,
      fabSize: config.chatFabSize,
      fabHide: config.chatFabHide,
      userName: config.chatUserName,
      userEmail: config.chatUserEmail,
      userId: config.chatUserId,
      container: config.chatContainer,
      consentRequired: config.chatConsentRequired,
      consentGranted: config.chatConsentGranted,
    }
  }
  return integrations
}

// A built-in plugin, declared before its code is loaded.
function builtIn(
  name: BuiltInPluginName,
  options: unknown,
  spec: {
    category: ConsentCategory
    loadWithoutConsent?: boolean
    cookies?: CookieRule[]
    storage?: StorageRule[]
    withdrawal?: WithdrawalMode
  },
): PluginSpec {
  return { name, ...spec, create: async () => (await pluginLoaders[name]())(options) }
}

/** All plugins for a config: built-in integrations (explicit settings win over legacy ones) and custom plugins. */
export function resolvePluginSpecs(config: AnalyticsConfig): PluginSpec[] {
  const integrations: IntegrationsConfig = { ...legacyIntegrations(config), ...config.integrations }
  const specs: PluginSpec[] = []

  const ga = integrations.googleAnalytics
  if (ga) {
    specs.push(
      builtIn('googleAnalytics', ga, {
        // Analytics runs with statistics consent; without a measurement ID it is Ads only.
        category: ga.measurementId ? 'statistics' : 'marketing',
        // A page-installed gtag is told "denied" until consent allows it.
        loadWithoutConsent: ga.loadScript === false,
        cookies: GOOGLE_COOKIES,
      }),
    )
  }
  const uet = integrations.microsoftUet
  if (uet) {
    specs.push(
      builtIn('microsoftUet', uet, {
        category: 'marketing',
        loadWithoutConsent: uet.loadScript === false,
        cookies: MICROSOFT_UET_COOKIES,
      }),
    )
  }
  const openai = integrations.openAIAds
  if (openai) specs.push(builtIn('openAIAds', openai, { category: 'marketing' }))

  const chat = integrations.clearIdeasChat
  if (chat && chat.accessKey) {
    specs.push(
      builtIn('clearIdeasChat', chat, {
        // Functional by default; with requiresConsent its storage counts as preferences.
        category: chat.requiresConsent === true ? 'preferences' : 'necessary',
      }),
    )
  }

  // The directory of common services (see docs/THIRD_PARTY.md).
  const { hubspot, intercom, metaPixel, linkedInInsight, microsoftClarity, hotjar } = integrations
  if (hubspot) {
    specs.push(
      builtIn('hubspot', hubspot, {
        category: hubspot.category ?? 'marketing',
        cookies: HUBSPOT_COOKIES,
      }),
    )
  }
  if (intercom) {
    specs.push(
      builtIn('intercom', intercom, {
        category: intercom.category ?? 'preferences',
        cookies: INTERCOM_COOKIES,
        storage: INTERCOM_STORAGE,
      }),
    )
  }
  if (metaPixel) {
    specs.push(
      builtIn('metaPixel', metaPixel, { category: 'marketing', cookies: META_PIXEL_COOKIES }),
    )
  }
  if (linkedInInsight) {
    specs.push(
      builtIn('linkedInInsight', linkedInInsight, {
        category: 'marketing',
        cookies: LINKEDIN_INSIGHT_COOKIES,
        withdrawal: 'reload',
      }),
    )
  }
  if (microsoftClarity) {
    specs.push(
      builtIn('microsoftClarity', microsoftClarity, {
        category: 'statistics',
        cookies: MICROSOFT_CLARITY_COOKIES,
        withdrawal: 'reload',
      }),
    )
  }
  if (hotjar) {
    specs.push(
      builtIn('hotjar', hotjar, {
        category: 'statistics',
        cookies: HOTJAR_COOKIES,
        storage: HOTJAR_STORAGE,
        withdrawal: 'reload',
      }),
    )
  }

  for (const plugin of config.plugins ?? []) {
    specs.push({
      name: plugin.name,
      category: pluginCategory(plugin),
      cookies: plugin.cookies,
      storage: plugin.storage,
      loadWithoutConsent: plugin.loadWithoutConsent,
      // A plugin that cannot be told about withdrawal cannot stop its vendor.
      withdrawal: plugin.withdrawal ?? (plugin.consentChanged ? 'stop' : 'reload'),
      create: () => plugin,
    })
  }
  return specs
}
