// First-party cookies set by vendor tags, deleted when their category is withdrawn. Kept
// apart from the plugin modules so the core can reference them without loading the plugins.
import type { CookieRule, StorageRule } from './types'

/** gtag.js: Google Analytics cookies (statistics) and Google Ads cookies (marketing). */
export const GOOGLE_COOKIES: CookieRule[] = [
  { name: /^_ga($|_)/, category: 'statistics' },
  { name: '_gid', category: 'statistics' },
  { name: /^_gat/, category: 'statistics' },
  { name: /^_gcl_/, category: 'marketing' },
]

/** Microsoft UET. */
export const MICROSOFT_UET_COOKIES: CookieRule[] = [/^_uet/]

/** HubSpot tracking (__hs*) and chat (messagesUtk). The opt-out cookies are kept. */
export const HUBSPOT_COOKIES: CookieRule[] = [
  '__hstc',
  '__hssc',
  '__hssrc',
  'hubspotutk',
  'messagesUtk',
]

/** Intercom Messenger: intercom-id-<app>, intercom-session-<app>, intercom-device-id-<app>. */
export const INTERCOM_COOKIES: CookieRule[] = [/^intercom-(id|session|device-id)-/]
export const INTERCOM_STORAGE: StorageRule[] = ['intercom.*']

/** Meta Pixel browser and click IDs. */
export const META_PIXEL_COOKIES: CookieRule[] = ['_fbp', '_fbc']

/** LinkedIn Insight Tag first-party cookies (its linkedin.com cookies cannot be removed). */
export const LINKEDIN_INSIGHT_COOKIES: CookieRule[] = ['li_fat_id', 'li_giant']

/** Microsoft Clarity first-party cookies. */
export const MICROSOFT_CLARITY_COOKIES: CookieRule[] = ['_clck', '_clsk']

/** Hotjar cookies and storage keys (_hjSession_<id>, _hjSessionUser_<id>, ...). */
export const HOTJAR_COOKIES: CookieRule[] = ['_hj*']
export const HOTJAR_STORAGE: StorageRule[] = ['_hj*']
