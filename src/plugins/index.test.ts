import { describe, expect, it } from 'vitest'

describe('@clearideas/consent-analytics/plugins entry', () => {
  it('exports the built-in plugin factories and vendor cookie lists', async () => {
    const entry = await import('./index')

    for (const factory of [
      'googleAnalytics',
      'microsoftUet',
      'openAIAds',
      'clearIdeasChat',
      'hubspot',
      'intercom',
      'metaPixel',
      'linkedInInsight',
      'microsoftClarity',
      'hotjar',
    ]) {
      expect(typeof (entry as any)[factory], factory).toBe('function')
    }
    expect(entry.googleAnalytics({ measurementId: 'G-1' }).name).toBe('googleAnalytics')
    expect(entry.GOOGLE_COOKIES).toContainEqual({ name: '_gid', category: 'statistics' })
    expect(typeof entry.getChatWidgetInstance).toBe('function')
  })
})
