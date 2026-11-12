import { describe, expect, it, vi } from 'vitest'

import { makeConfig } from '../test/helpers'
import { captureInitialAttribution } from './attribution'
import { STORAGE_KEYS } from './types'

describe('captureInitialAttribution', () => {
  const config = makeConfig()

  it('captures attribution from the current URL', () => {
    window.history.replaceState(
      null,
      '',
      '/landing/ai-governance?utm_source=google&utm_medium=cpc&utm_campaign=governance',
    )

    const attribution = captureInitialAttribution(config)

    expect(attribution).toMatchObject({
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'governance',
      landingPath: '/landing/ai-governance',
    })
    expect(localStorage.getItem(STORAGE_KEYS.ATTRIBUTION_CONTEXT)).not.toBeNull()
  })

  it('preserves stored first-touch attribution when the current URL has new attribution', () => {
    localStorage.setItem(
      STORAGE_KEYS.ATTRIBUTION_CONTEXT,
      JSON.stringify({
        utm_source: 'old-source',
        utm_medium: 'old-medium',
        utm_campaign: 'old-campaign',
        firstSeen: '2026-01-01T00:00:00.000Z',
      }),
    )
    window.history.replaceState(
      null,
      '',
      '/landing/ai-governance?utm_source=linkedin&utm_medium=paid&utm_campaign=ai-governance',
    )

    const attribution = captureInitialAttribution(config)

    expect(attribution).toMatchObject({
      utm_source: 'old-source',
      utm_medium: 'old-medium',
      utm_campaign: 'old-campaign',
      firstSeen: '2026-01-01T00:00:00.000Z',
    })
    expect(attribution?.utm_source).not.toBe('linkedin')
  })

  it('falls back to stored attribution without rewriting it when the URL has none', () => {
    localStorage.setItem(
      STORAGE_KEYS.ATTRIBUTION_CONTEXT,
      JSON.stringify({
        utm_source: 'stored-source',
        utm_medium: 'stored-medium',
        firstSeen: '2026-01-01T00:00:00.000Z',
      }),
    )
    window.history.replaceState(null, '', '/landing/ai-governance')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    const attribution = captureInitialAttribution(config)

    expect(attribution).toMatchObject({
      utm_source: 'stored-source',
      utm_medium: 'stored-medium',
    })
    expect(setItem).not.toHaveBeenCalled()
  })
})

describe('extractAttributionFromUrl', () => {
  it('accepts only known attribution keys', async () => {
    const { extractAttributionFromUrl } = await import('./attribution')

    expect(
      extractAttributionFromUrl('https://a.test/?utm_source=a&utm_evil=1&ci_anything=2&gclid=g'),
    ).toEqual({ utm_source: 'a', gclid: 'g' })
  })

  it('drops oversized values and strips control characters', async () => {
    const { extractAttributionFromUrl } = await import('./attribution')

    expect(
      extractAttributionFromUrl(
        `https://a.test/?utm_source=ok%0A%00x&utm_campaign=${'A'.repeat(300)}`,
      ),
    ).toEqual({ utm_source: 'okx' })
  })
})

describe('normalizeAttribution', () => {
  it('keeps known string fields and sanitizes metadata from untrusted storage', async () => {
    const { normalizeAttribution } = await import('./attribution')

    expect(
      normalizeAttribution({
        utm_source: 'ok',
        utm_injected: 'bad',
        gclid: { nested: true },
        referrer: 'https://a.test/p?secret=1#f',
        landingPath: '/landing?token=1',
        firstSeen: 'not-a-date',
        lastSeen: '2026-01-01T00:00:00.000Z',
      }),
    ).toEqual({
      utm_source: 'ok',
      referrer: 'https://a.test/p',
      landingPath: '/landing',
      lastSeen: '2026-01-01T00:00:00.000Z',
    })
  })

  it('returns null for non-objects and objects without usable fields', async () => {
    const { normalizeAttribution } = await import('./attribution')

    expect(normalizeAttribution(null)).toBeNull()
    expect(normalizeAttribution('x')).toBeNull()
    expect(normalizeAttribution([])).toBeNull()
    expect(normalizeAttribution({ junk: 1 })).toBeNull()
  })
})
