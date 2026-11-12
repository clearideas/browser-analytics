// DOM helpers for plugins: script/stylesheet loading and cookie removal.
import type { ResourceOptions } from './types'

const pending = new Map<string, Promise<void>>()

function load(kind: 'script' | 'link', url: string, options: ResourceOptions = {}): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve()
  const key = `${kind}:${url}`
  const existing = pending.get(key)
  if (existing) return existing

  const promise = new Promise<void>((resolve, reject) => {
    const element =
      kind === 'script' ? document.createElement('script') : document.createElement('link')
    if (element instanceof HTMLScriptElement) {
      element.async = true
      element.src = url
    } else {
      element.rel = 'stylesheet'
      element.href = url
    }
    if (options.integrity) {
      element.integrity = options.integrity
      element.crossOrigin = 'anonymous'
    }
    element.addEventListener('load', () => resolve(), { once: true })
    element.addEventListener(
      'error',
      () => {
        pending.delete(key)
        element.remove()
        reject(new Error(`Failed to load ${url}`))
      },
      { once: true },
    )
    document.head.appendChild(element)
  })
  pending.set(key, promise)
  return promise
}

export function loadScript(src: string, options?: ResourceOptions): Promise<void> {
  return load('script', src, options)
}

export function loadStylesheet(href: string, options?: ResourceOptions): Promise<void> {
  return load('link', href, options)
}

/** Forget loaded resources (tests). */
export function resetLoadedResources(): void {
  pending.clear()
}

/** Whether a name matches any pattern (string = exact name, or prefix ending in "*"). */
export function matchesAny(name: string, patterns: Array<string | RegExp>): boolean {
  return patterns.some(pattern =>
    pattern instanceof RegExp
      ? pattern.test(name)
      : pattern.endsWith('*')
        ? name.startsWith(pattern.slice(0, -1))
        : name === pattern,
  )
}

/**
 * Delete first-party cookies whose names match any pattern. A cookie can only be deleted
 * with the Domain it was set with, so the current host and every parent domain are tried.
 * (HttpOnly cookies and cookies of other sites cannot be deleted from a page.)
 */
export function deleteCookies(patterns: Array<string | RegExp>): string[] {
  if (typeof document === 'undefined' || patterns.length === 0) return []
  const labels = window.location.hostname.split('.')
  const domains =
    labels.length > 1 ? labels.slice(0, -1).map((_, i) => labels.slice(i).join('.')) : []
  const deleted: string[] = []
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0]?.trim()
    if (!name || !matchesAny(name, patterns)) continue
    document.cookie = `${name}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/`
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Domain=.${domain}`
    }
    deleted.push(name)
  }
  return deleted
}

/** Remove localStorage and sessionStorage keys that match any pattern. */
export function deleteStorageKeys(patterns: Array<string | RegExp>): string[] {
  if (typeof window === 'undefined' || patterns.length === 0) return []
  const deleted: string[] = []
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      const keys: string[] = []
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i)
        if (key !== null && matchesAny(key, patterns)) keys.push(key)
      }
      for (const key of keys) storage.removeItem(key)
      deleted.push(...keys)
    } catch {
      // Storage unavailable (e.g. blocked): nothing to remove.
    }
  }
  return deleted
}

/** Page reload used after a withdrawal that cannot be applied in place. Replaceable in tests. */
export const pageReloader = {
  reload: (): void => {
    if (typeof window !== 'undefined') window.location.reload()
  },
}
