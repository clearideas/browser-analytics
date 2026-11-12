const IP_ADDRESS_REGEX = /^\d{1,3}(?:\.\d{1,3}){3}$/
const DOMAIN_REGEX = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/

/**
 * Validate an explicitly configured cookie domain against the current host.
 *
 * Returns the domain in `.example.com` form when `hostname` is that domain or one of
 * its subdomains, otherwise null. There is deliberately no guessing: guessing the
 * "registrable" domain shares cookies across unrelated tenants on multi-tenant hosts
 * (e.g. `tenant1.saas.com` -> `.saas.com`) and fails on many country-code TLDs.
 * Without a configured domain, nothing is shared across subdomains.
 */
export function resolveCookieDomain(
  hostname?: string | null,
  configuredDomain?: string | null,
): string | null {
  if (!hostname || !configuredDomain) return null

  const domain = configuredDomain.trim().toLowerCase().replace(/^\./, '')
  const host = hostname.toLowerCase()

  if (!DOMAIN_REGEX.test(domain) || IP_ADDRESS_REGEX.test(domain)) return null
  if (host !== domain && !host.endsWith(`.${domain}`)) return null

  return `.${domain}`
}
