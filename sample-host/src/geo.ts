// Visitor region -> consent policy.
//
// Any way of finding the country works (an IP geolocation service such as IPInfo, or a
// CDN header). This host reads trusted CDN headers; replace resolveGeo() to plug in
// something else. Unknown region always means consent is required.
import type { HostConfig, SiteConfig } from './config.ts'

export interface Geo {
  country?: string
  continent?: string
}

export interface Policy {
  consentRequired: boolean
  policyVersion: string
  trackingWithoutConsent: 'limited' | 'none'
  reason: 'region' | 'site' | 'unknown-region'
}

const COUNTRY = /^[A-Z]{2}$/
const CONTINENTS = new Set(['AF', 'AN', 'AS', 'EU', 'NA', 'OC', 'SA'])
// Placeholder values some CDNs use: XX = unknown, T1 = Tor (Cloudflare).
const NOT_A_COUNTRY = new Set(['XX', 'T1'])

export function resolveGeo(headers: Headers, config: HostConfig, override?: Geo | null): Geo {
  if (override?.country) return override

  for (const header of config.trustedGeoHeaders) {
    const value = headers.get(header)?.trim().toUpperCase()
    if (value && COUNTRY.test(value) && !NOT_A_COUNTRY.has(value)) {
      const continent = headers.get('cf-ipcontinent')?.trim().toUpperCase()
      return {
        country: value,
        ...(continent &&
        CONTINENTS.has(continent) &&
        config.trustedGeoHeaders.includes('cf-ipcontinent')
          ? { continent }
          : {}),
      }
    }
  }

  return config.defaultCountry ? { country: config.defaultCountry } : {}
}

export function policyFor(site: SiteConfig, geo: Geo, config: HostConfig): Policy {
  // Some regions allow nothing without consent; elsewhere the site setting applies.
  const strictRegion = !!geo.country && !!config.noTrackingWithoutConsentCountries?.has(geo.country)
  const trackingWithoutConsent: 'limited' | 'none' =
    strictRegion || site.trackingWithoutConsent === 'none' ? 'none' : 'limited'
  const base = { policyVersion: site.policyVersion, trackingWithoutConsent }
  if (site.consentMode === 'always') return { ...base, consentRequired: true, reason: 'site' }
  if (site.consentMode === 'never') return { ...base, consentRequired: false, reason: 'site' }
  if (!geo.country) return { ...base, consentRequired: true, reason: 'unknown-region' }
  return { ...base, consentRequired: config.consentCountries.has(geo.country), reason: 'region' }
}
