import { describe, expect, it } from 'vitest'

import { makeConfig } from '../../test/helpers'
import { legacyIntegrations, resolvePluginSpecs } from './registry'

describe('legacyIntegrations', () => {
  it('maps the pre-plugin flat settings with their previous behavior', () => {
    expect(
      legacyIntegrations(
        makeConfig({
          gaMeasurementId: 'G-1',
          googleAdsConversions: { sign_up: 'AW-1/x' },
          microsoftAdsTagId: 'T',
          microsoftAdsGoals: { purchase: 'G' },
          openAIAdsPixelId: 'px',
          chatAccessKey: 'k',
          chatPosition: 'bottom-left',
        }),
      ),
    ).toMatchObject({
      googleAnalytics: {
        measurementId: 'G-1',
        adsConversions: { sign_up: 'AW-1/x' },
        loadScript: false,
        events: 'all',
      },
      microsoftUet: { tagId: 'T', goals: { purchase: 'G' }, loadScript: false, events: 'all' },
      openAIAds: { pixelId: 'px' },
      clearIdeasChat: { accessKey: 'k', position: 'bottom-left' },
    })
  })

  it('maps nothing for an empty config, and honors chatEnabled: false', () => {
    expect(legacyIntegrations(makeConfig({ microsoftAdsGoals: {} }))).toEqual({})
    expect(legacyIntegrations(makeConfig({ chatAccessKey: 'k', chatEnabled: false }))).toEqual({})
  })
})

describe('resolvePluginSpecs', () => {
  it('explicit integrations win over legacy settings, and false disables one', async () => {
    const specs = resolvePluginSpecs(
      makeConfig({
        gaMeasurementId: 'G-LEGACY',
        chatAccessKey: 'k',
        integrations: { googleAnalytics: { measurementId: 'G-NEW' }, clearIdeasChat: false },
      }),
    )

    expect(specs.map(s => s.name)).toEqual(['googleAnalytics'])
    const plugin = await specs[0]!.create()
    expect(plugin.name).toBe('googleAnalytics')
  })

  it('declares consent requirements and vendor cookies without loading plugin code', () => {
    const specs = resolvePluginSpecs(
      makeConfig({
        integrations: {
          googleAnalytics: { measurementId: 'G' },
          microsoftUet: { tagId: 'T' },
          openAIAds: { pixelId: 'p' },
          clearIdeasChat: { accessKey: 'k' },
        },
      }),
    )
    expect(Object.fromEntries(specs.map(s => [s.name, s.category]))).toEqual({
      googleAnalytics: 'statistics',
      microsoftUet: 'marketing',
      openAIAds: 'marketing',
      clearIdeasChat: 'necessary',
    })
    expect(specs.find(s => s.name === 'googleAnalytics')!.cookies).toContainEqual({
      name: /^_gcl_/,
      category: 'marketing',
    })
  })

  it('declares the directory plugins with their category, data and withdrawal mode', () => {
    const specs = resolvePluginSpecs(
      makeConfig({
        integrations: {
          hubspot: { portalId: 1 },
          intercom: { appId: 'a' },
          metaPixel: { pixelId: '123456' },
          linkedInInsight: { partnerId: 1 },
          microsoftClarity: { projectId: 'a' },
          hotjar: { siteId: 1 },
        },
      }),
    )
    expect(specs.map(s => [s.name, s.category, s.withdrawal ?? 'stop'])).toEqual([
      ['hubspot', 'marketing', 'stop'],
      ['intercom', 'preferences', 'stop'],
      ['metaPixel', 'marketing', 'stop'],
      ['linkedInInsight', 'marketing', 'reload'],
      ['microsoftClarity', 'statistics', 'reload'],
      ['hotjar', 'statistics', 'reload'],
    ])
    expect(specs.find(s => s.name === 'hotjar')!.storage).toEqual(['_hj*'])
  })

  it('each directory plugin’s declaration matches the plugin itself', async () => {
    const specs = resolvePluginSpecs(
      makeConfig({
        integrations: {
          hubspot: { portalId: 1, category: 'statistics' },
          intercom: { appId: 'a', category: 'necessary' },
          metaPixel: { pixelId: '123456' },
          linkedInInsight: { partnerId: 1 },
          microsoftClarity: { projectId: 'a' },
          hotjar: { siteId: 1 },
        },
      }),
    )
    for (const spec of specs) {
      const plugin = await spec.create()
      expect(plugin.name, spec.name).toBe(spec.name)
      expect(plugin.category, spec.name).toBe(spec.category)
      expect(plugin.cookies, spec.name).toEqual(spec.cookies)
      expect(plugin.storage, spec.name).toEqual(spec.storage)
      expect(plugin.withdrawal ?? 'stop', spec.name).toBe(spec.withdrawal ?? 'stop')
    }
  })

  it('ignores a chat integration without an access key', () => {
    expect(
      resolvePluginSpecs(makeConfig({ integrations: { clearIdeasChat: { accessKey: '' } } })),
    ).toEqual([])
  })

  it('adds custom plugins: marketing unless they declare a category', async () => {
    const custom = { name: 'mine', track: () => {} }
    const functional = { name: 'widget', requiresConsent: false }
    const specs = resolvePluginSpecs(makeConfig({ plugins: [custom, functional] }))

    expect(specs.map(s => [s.name, s.category])).toEqual([
      ['mine', 'marketing'],
      ['widget', 'necessary'],
    ])
    expect(await specs[0]!.create()).toBe(custom)
  })

  it('custom plugins: withdrawal reloads unless the plugin can stop its vendor', () => {
    const specs = resolvePluginSpecs(
      makeConfig({
        plugins: [
          { name: 'a' },
          { name: 'b', consentChanged: () => {} },
          { name: 'c', withdrawal: 'stop' },
          { name: 'd', loadWithoutConsent: true, storage: ['d.*'] },
        ],
      }),
    )
    expect(specs.map(s => s.withdrawal)).toEqual(['reload', 'stop', 'stop', 'reload'])
    expect(specs[3]).toMatchObject({ loadWithoutConsent: true, storage: ['d.*'] })
  })
})
