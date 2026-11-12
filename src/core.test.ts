import { describe, expect, it } from 'vitest'

import { extractUtmParameters, generateObjectId } from './core'

describe('generateObjectId', () => {
  it('generates a 24-character lowercase hex ObjectId-style string', () => {
    const id = generateObjectId()

    expect(id).toMatch(/^[0-9a-f]{24}$/)
  })

  it('generates unique IDs', () => {
    expect(generateObjectId()).not.toBe(generateObjectId())
  })
})

describe('extractUtmParameters', () => {
  it('extracts UTM parameters from a URL', () => {
    const params = extractUtmParameters(
      'https://example.com?utm_source=google&utm_medium=cpc&utm_campaign=summer',
    )

    expect(params).toEqual({
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'summer',
    })
  })

  it('extracts internal ci_* campaign parameters from a URL', () => {
    const params = extractUtmParameters(
      'https://example.com?ci_source=clearideas&ci_medium=website&ci_campaign=sign_up&ci_term=header',
    )

    expect(params).toEqual({
      ci_source: 'clearideas',
      ci_medium: 'website',
      ci_campaign: 'sign_up',
      ci_term: 'header',
    })
  })

  it('returns an empty object for a URL without campaign parameters', () => {
    expect(extractUtmParameters('https://example.com/path')).toEqual({})
  })
})

describe('sanitizeUrl', () => {
  it('keeps campaign parameters and drops everything else, including the fragment', async () => {
    const { sanitizeUrl } = await import('./core')

    expect(
      sanitizeUrl(
        'https://a.test/p?token=1&utm_source=x&ci_campaign=y&gclid=z&email=a%40b.com#access_token=t',
      ),
    ).toBe('https://a.test/p?utm_source=x&ci_campaign=y')
  })

  it('keeps extra allowed parameters', async () => {
    const { sanitizeUrl } = await import('./core')

    expect(sanitizeUrl('https://a.test/s?q=shoes&token=1', { allowQueryParams: ['q'] })).toBe(
      'https://a.test/s?q=shoes',
    )
  })

  it('can drop all query parameters (origin + path)', async () => {
    const { sanitizeUrl } = await import('./core')

    expect(sanitizeUrl('https://a.test/p?utm_source=x', { allowQueryParams: [] })).toBe(
      'https://a.test/p',
    )
  })

  it('removes embedded credentials', async () => {
    const { sanitizeUrl } = await import('./core')

    expect(sanitizeUrl('https://user:pass@a.test/p')).toBe('https://a.test/p')
  })

  it('never returns a query or fragment for relative or unparseable input', async () => {
    const { sanitizeUrl } = await import('./core')

    expect(sanitizeUrl('/p?token=1#frag')).toBe('/p')
    expect(sanitizeUrl('not a url?token=1')).toBe('not a url')
    expect(sanitizeUrl('')).toBe('')
  })
})

describe('sanitizeUrlForAnonymous', () => {
  it('returns origin + path and never leaks the query, even for unparseable input', async () => {
    const { sanitizeUrlForAnonymous } = await import('./core')

    expect(sanitizeUrlForAnonymous('https://a.test/p?utm_source=x#f')).toBe('https://a.test/p')
    expect(sanitizeUrlForAnonymous('/relative?token=1#f')).toBe('/relative')
  })
})

describe('createAnonymousEventData', () => {
  it('keeps a truncated error message but not stack traces or arbitrary fields', async () => {
    const { createAnonymousEventData } = await import('./core')

    const data = createAnonymousEventData({
      message: 'x'.repeat(600),
      stack: 'at foo',
      email: 'a@b.com',
      path: '/p',
    })

    expect(data.message).toHaveLength(500)
    expect(data.stack).toBeUndefined()
    expect(data.email).toBeUndefined()
    expect(data.path).toBe('/p')
  })
})
