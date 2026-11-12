// Helpers shared by the built-in plugins.

/** Events this library sends by itself (not the site's own events). */
export const AUTOMATIC_EVENTS: ReadonlySet<string> = new Set([
  'page_view',
  'page_exit',
  'scroll_depth',
  'time_spent',
  'outbound_link_click',
  'web_vital',
  'auto_metrics',
  'error',
])

/**
 * A vendor account ID from the configuration, checked against the vendor's format before
 * it is used in a script URL (so a configuration value can never point the URL elsewhere).
 * Returns null, with a warning, if it does not match.
 */
export function vendorId(
  value: string | number | undefined,
  pattern: RegExp,
  plugin: string,
  field: string,
): string | null {
  const id = value === undefined || value === null ? '' : String(value).trim()
  if (pattern.test(id)) return id
  console.warn(
    `[Analytics] ${plugin}: ${field} is missing or invalid; the integration is not loaded`,
  )
  return null
}

/** Path and query of a (sanitized) page URL, for vendors that take a path. */
export function pathOf(url: unknown, fallback: unknown): string {
  if (typeof url === 'string' && url) {
    try {
      const parsed = new URL(url)
      return `${parsed.pathname}${parsed.search}`
    } catch {
      // fall through
    }
  }
  return typeof fallback === 'string' && fallback ? fallback : '/'
}
