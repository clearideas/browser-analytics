const PUBLIC_SUFFIXES = new Set(['co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'net.au', 'com.au'])

const IP_ADDRESS_REGEX = /^\d{1,3}(?:\.\d{1,3}){3}$/

export function resolveCookieDomain(hostname?: string | null, override?: string): string | null {
  if (override) {
    return override
  }

  if (!hostname || hostname === 'localhost') {
    return null
  }

  if (IP_ADDRESS_REGEX.test(hostname)) {
    return null
  }

  const parts = hostname.split('.').filter(Boolean)
  if (parts.length < 2) {
    return null
  }

  const lastTwo = parts.slice(-2).join('.')
  if (PUBLIC_SUFFIXES.has(lastTwo) && parts.length >= 3) {
    return `.${parts.slice(-3).join('.')}`
  }

  return `.${lastTwo}`
}
