// Public entry: @clearideas/consent-analytics/plugins
// Built-in plugin factories for use with `plugins: [...]`, and the plugin contract for
// writing your own. (Configured by name via `integrations`, they load automatically.)
export type {
  ChatWidgetLoader,
  ClearIdeasChatOptions,
  ClearIdeasWidgetInstance,
} from './clearideas-chat'
export {
  CHAT_WIDGET_READY_EVENT,
  clearIdeasChat,
  getChatWidgetInstance,
  setChatWidgetLoader,
} from './clearideas-chat'
export type { GoogleAnalyticsOptions } from './google-analytics'
export { googleAnalytics } from './google-analytics'
export type { HotjarOptions } from './hotjar'
export { hotjar } from './hotjar'
export type { HubSpotOptions } from './hubspot'
export { hubspot } from './hubspot'
export type { IntercomOptions, IntercomUser } from './intercom'
export { intercom } from './intercom'
export type { LinkedInInsightOptions } from './linkedin-insight'
export { linkedInInsight } from './linkedin-insight'
export type { MetaPixelOptions } from './meta-pixel'
export { metaPixel } from './meta-pixel'
export type { MicrosoftClarityOptions } from './microsoft-clarity'
export { microsoftClarity } from './microsoft-clarity'
export type { MicrosoftUetOptions } from './microsoft-uet'
export { microsoftUet } from './microsoft-uet'
export type { OpenAIAdsOptions } from './openai-ads'
export { openAIAds } from './openai-ads'
export type {
  AnalyticsPlugin,
  ConsentState,
  CookieRule,
  NameRule,
  PluginConsentState,
  PluginContext,
  PluginEvent,
  ResourceOptions,
  StorageRule,
  WithdrawalMode,
} from './types'
export {
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
