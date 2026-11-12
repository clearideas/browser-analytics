// Sample host configuration (environment variables + optional sites file).
import { readFileSync } from 'node:fs'

export type ConsentMode = 'geo' | 'always' | 'never'

export interface SiteConfig {
  siteKey: string
  name?: string
  /** Exact browser origins allowed to use this site key, e.g. "https://www.example.com". */
  allowedOrigins: string[]
  /** Bump to invalidate stored consent decisions (visitors are asked again). */
  policyVersion: string
  /** geo: by visitor region (default). always/never: regardless of region. */
  consentMode: ConsentMode
  /**
   * Where consent is required and not given: 'limited' (default) lets browsers send
   * anonymous essential events; 'none' lets them send nothing.
   */
  trackingWithoutConsent?: 'limited' | 'none'
}

export interface HostConfig {
  port: number
  playgroundPort: number
  /** Enables /_dev endpoints, the playground and the geo override. Never enable in production. */
  devMode: boolean
  /** SQLite file path, or ":memory:". */
  databasePath: string
  /**
   * Request headers that carry the visitor's country, set by a CDN/proxy in front of
   * this host (e.g. cf-ipcountry, cloudfront-viewer-country, x-vercel-ip-country).
   * Only list headers your proxy overwrites: if clients can reach this host directly,
   * they can send the header themselves and choose their own consent policy.
   */
  trustedGeoHeaders: string[]
  /** Country to assume when none is known (local development). Unset = unknown = consent required. */
  defaultCountry?: string
  /** Countries where consent is required (ISO 3166-1 alpha-2). */
  consentCountries: Set<string>
  /** Countries where nothing may be tracked without consent (policy trackingWithoutConsent: none). */
  noTrackingWithoutConsentCountries?: Set<string>
  contextTtlSeconds: number
  sites: SiteConfig[]
}

// EU member states, EEA (Iceland, Liechtenstein, Norway), United Kingdom, Switzerland.
export const DEFAULT_CONSENT_COUNTRIES = [
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
  'IS',
  'LI',
  'NO',
  'GB',
  'CH',
]

const SITE_KEY = /^[A-Za-z0-9._-]{3,64}$/
const COUNTRY = /^[A-Z]{2}$/

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function truthy(value: string | undefined): boolean {
  return value === '1' || value === 'true'
}

function validateSite(raw: unknown, index: number): SiteConfig {
  const site = raw as Partial<SiteConfig>
  const where = `sites[${index}]`
  if (!site || typeof site !== 'object') throw new Error(`${where} must be an object`)
  if (typeof site.siteKey !== 'string' || !SITE_KEY.test(site.siteKey)) {
    throw new Error(`${where}.siteKey must match ${SITE_KEY}`)
  }
  if (!Array.isArray(site.allowedOrigins) || site.allowedOrigins.length === 0) {
    throw new Error(`${where}.allowedOrigins must be a non-empty array`)
  }
  for (const origin of site.allowedOrigins) {
    let parsed: URL
    try {
      parsed = new URL(origin)
    } catch {
      throw new Error(`${where}.allowedOrigins: "${origin}" is not a URL`)
    }
    if (parsed.origin !== origin) {
      throw new Error(
        `${where}.allowedOrigins: "${origin}" must be an exact origin like "${parsed.origin}"`,
      )
    }
  }
  const consentMode = site.consentMode ?? 'geo'
  if (!['geo', 'always', 'never'].includes(consentMode)) {
    throw new Error(`${where}.consentMode must be geo, always or never`)
  }
  const trackingWithoutConsent = site.trackingWithoutConsent ?? 'limited'
  if (!['limited', 'none'].includes(trackingWithoutConsent)) {
    throw new Error(`${where}.trackingWithoutConsent must be limited or none`)
  }
  return {
    siteKey: site.siteKey,
    name: site.name,
    allowedOrigins: [...site.allowedOrigins],
    policyVersion: String(site.policyVersion ?? '1'),
    consentMode,
    trackingWithoutConsent,
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): HostConfig {
  const port = Number(env.PORT ?? 8787)
  const playgroundPort = Number(env.PLAYGROUND_PORT ?? 5173)

  let sites: SiteConfig[]
  if (env.SITES_FILE) {
    const parsed = JSON.parse(readFileSync(env.SITES_FILE, 'utf8'))
    if (!Array.isArray(parsed)) throw new Error('SITES_FILE must contain a JSON array')
    sites = parsed.map(validateSite)
  } else {
    sites = [
      {
        siteKey: 'demo-site',
        name: 'Playground',
        allowedOrigins: [
          `http://localhost:${playgroundPort}`,
          `http://127.0.0.1:${playgroundPort}`,
        ],
        policyVersion: '1',
        consentMode: 'geo',
      },
    ]
  }

  const defaultCountry = env.DEFAULT_COUNTRY?.toUpperCase()
  if (defaultCountry && !COUNTRY.test(defaultCountry)) {
    throw new Error('DEFAULT_COUNTRY must be an ISO 3166-1 alpha-2 code')
  }

  const consentCountries = list(env.CONSENT_COUNTRIES).map(c => c.toUpperCase())

  return {
    port,
    playgroundPort,
    devMode: truthy(env.DEV_MODE),
    databasePath: env.DATABASE_PATH ?? './data/analytics.db',
    trustedGeoHeaders: list(env.TRUSTED_GEO_HEADERS).map(h => h.toLowerCase()),
    defaultCountry: defaultCountry || undefined,
    consentCountries: new Set(
      consentCountries.length ? consentCountries : DEFAULT_CONSENT_COUNTRIES,
    ),
    noTrackingWithoutConsentCountries: new Set(
      list(env.NO_TRACKING_WITHOUT_CONSENT_COUNTRIES).map(c => c.toUpperCase()),
    ),
    contextTtlSeconds: Number(env.CONTEXT_TTL_SECONDS ?? 3600),
    sites,
  }
}
